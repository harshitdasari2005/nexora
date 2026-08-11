/**
 * @nexora/application-documents — document storage port.
 *
 * The object-storage seam (PERSISTENCE.md §2 multi-model: binary content is
 * NEVER stored in PostgreSQL — metadata is relational, content lives behind
 * this port). The domain never sees bytes; the application layer moves
 * content through this abstraction. Replaceable: the default in-memory
 * implementation serves tests/local; a MinIO/S3 implementation can swap in
 * without touching the application or domain.
 */

/** The document binary storage port (opaque keys, no business meaning). */
export interface DocumentStorage {
  /** Stores the binary content at the given key. */
  store(key: string, content: Buffer): Promise<void>;
  /** Loads the binary content at the given key (undefined when absent). */
  load(key: string): Promise<Buffer | undefined>;
  /** Removes the binary content at the given key (idempotent). */
  remove(key: string): Promise<void>;
}

/** An in-memory {@link DocumentStorage} (tests + local runs). */
export class InMemoryDocumentStorage implements DocumentStorage {
  readonly #contents = new Map<string, Buffer>();

  /** The stored contents (test introspection). */
  get contents(): ReadonlyMap<string, Buffer> {
    return this.#contents;
  }

  async store(key: string, content: Buffer): Promise<void> {
    this.#contents.set(key, Buffer.from(content));
  }

  async load(key: string): Promise<Buffer | undefined> {
    return this.#contents.get(key);
  }

  async remove(key: string): Promise<void> {
    this.#contents.delete(key);
  }
}
