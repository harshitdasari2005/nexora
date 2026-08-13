/**
 * @nexora/app-api — MinIO/S3 document storage adapter.
 *
 * The durable implementation of the {@link DocumentStorage} port (S17 Phase
 * 3): binary document content lives in an S3-compatible object store (MinIO
 * is provisioned in infrastructure/compose). The adapter is infrastructure —
 * the documents domain never knows MinIO exists; it only sees the port.
 *
 * - Object keys are the opaque {@link ContentRef} values handed to the port
 *   (deterministic, never business-meaningful). Tenant/workspace isolation
 *   is enforced by the APPLICATION layer BEFORE a key ever reaches the
 *   adapter: the adapter is dumb storage and can only ever be handed keys
 *   the caller has already authorized.
 * - A missing object resolves to `undefined` on `load` (NoSuchKey is mapped,
 *   not thrown), preserving the port contract.
 * - The bucket is created idempotently on first use (lazy, cached).
 * - Credentials come from the environment (ApiConfig.s3) — never hard-coded.
 */

import { Client as MinioClient, type S3Error } from 'minio';
import type { DocumentStorage } from '@nexora/application-documents';

/** S3/MinIO connection configuration (from the environment). */
export interface MinioStorageConfig {
  /** The S3 endpoint host (e.g. `localhost` for the compose MinIO). */
  endPoint: string;
  /** The S3 endpoint port (e.g. `9000`). */
  port: number;
  /** Whether the endpoint requires TLS. */
  useSSL: boolean;
  /** The access key. */
  accessKey: string;
  /** The secret key. */
  secretKey: string;
  /** The bucket holding document content. */
  bucket: string;
}

/** The minimum bucket-creation retry interval (lazy, cached). */
const BUCKET_POLL_MS = 200;

/**
 * S3/MinIO {@link DocumentStorage} implementation. Object keys are stored
 * verbatim; `load` maps a missing object to `undefined`.
 */
export class MinioDocumentStorage implements DocumentStorage {
  readonly #client: MinioClient;
  readonly #bucket: string;
  #bucketReady: Promise<void> | undefined;

  constructor(config: MinioStorageConfig) {
    this.#client = new MinioClient({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
    this.#bucket = config.bucket;
  }

  async store(key: string, content: Buffer): Promise<void> {
    await this.#ensureBucket();
    await this.#client.putObject(this.#bucket, key, content, content.length, {
      'Content-Type': 'application/octet-stream',
    });
  }

  async load(key: string): Promise<Buffer | undefined> {
    await this.#ensureBucket();
    try {
      const stream = await this.#client.getObject(this.#bucket, key);
      return await streamToBuffer(stream);
    } catch (error) {
      if (isNoSuchKey(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await this.#ensureBucket();
    await this.#client.removeObject(this.#bucket, key);
  }

  /** Ensures the bucket exists once (idempotent, lazy, cached). */
  #ensureBucket(): Promise<void> {
    if (this.#bucketReady === undefined) {
      this.#bucketReady = this.#createBucket();
    }
    return this.#bucketReady;
  }

  async #createBucket(): Promise<void> {
    const exists = await this.#client.bucketExists(this.#bucket);
    if (exists) {
      return;
    }
    await this.#client.makeBucket(this.#bucket);
    // Bucket creation is eventually consistent on some S3 implementations:
    // poll briefly so the first store does not race the create.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (await this.#client.bucketExists(this.#bucket)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, BUCKET_POLL_MS));
    }
  }
}

/** Collects an S3 object stream into a Buffer. */
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

/** True when the error is an S3 NoSuchKey (the port's `undefined` case). */
function isNoSuchKey(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as S3Error).code;
  return code === 'NoSuchKey' || code === 'NotFound';
}
