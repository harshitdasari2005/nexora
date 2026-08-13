/**
 * @nexora/app-api — typed environment configuration.
 *
 * The API container reads its configuration from the environment
 * (documented in `.env.example`). Values are validated on load so a
 * misconfigured container fails fast at boot (ENGINEERING_PLAYBOOK.md §4.2).
 */

/** OIDC (Keycloak) client configuration. */
export interface OidcConfig {
  /** The OIDC issuer URL, e.g. `http://localhost:8080/realms/nexora`. */
  issuerUrl: string;
  /** The OIDC client id (public client — no secret for the auth-code PKCE-less flow). */
  clientId: string;
  /** The registered redirect URI of this API. */
  redirectUri: string;
}

/** Enterprise AI Runtime configuration. */
export interface AiConfig {
  /** Groq API key (optional; deterministic narration is used when absent). */
  groqApiKey?: string;
  /** The model served by the Groq provider (e.g. `llama-3.3-70b-versatile`). */
  model: string;
}

/** Webhook/email inbound signing configuration (BKD §9.2). */
export interface IntegrationsConfig {
  /**
   * Shared HMAC secret for the signed inbound email endpoint. In production
   * this is a per-deployment secret distributed out-of-band to the email
   * action provider; in local dev the documented default is used.
   */
  inboundSecret: string;
}

/** S3/MinIO object-storage configuration (durable document content). */
export interface S3Config {
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

/** Session cookie options. */
export interface CookieConfig {
  /** The cookie name holding the session token. */
  name: string;
  /** SameSite policy for the session cookie. */
  sameSite: 'lax' | 'strict' | 'none';
  /** Whether the cookie requires HTTPS. */
  secure: boolean;
  /** Cookie lifetime in seconds (aligned with the domain session TTL). */
  maxAgeSeconds: number;
}

/** The API container configuration. */
export interface ApiConfig {
  /** HTTP listen port. */
  port: number;
  /** HTTP listen host. */
  host: string;
  /** PostgreSQL connection string. */
  databaseUrl: string;
  /** Apply pending migrations at boot. */
  autoMigrate: boolean;
  /** The web application origin (post-login redirect target). */
  webOrigin: string;
  /** OIDC configuration. */
  oidc: OidcConfig;
  /** Session cookie options. */
  cookie: CookieConfig;
  /** Enterprise AI Runtime configuration. */
  ai: AiConfig;
  /** Integrations (webhook-in signing, email) configuration. */
  integrations: IntegrationsConfig;
  /**
   * S3/MinIO object storage. `undefined` when S3_ENDPOINT is not set — the
   * container then falls back to the in-memory storage port (local dev
   * without MinIO). Durable content requires S3 configured.
   */
  s3: S3Config | undefined;
  /** Structured log level. */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function required(env: NodeJS.ProcessEnv, name: string, fallback?: string): string {
  const value = env[name] ?? fallback;
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Loads and validates the API configuration from the environment.
 *
 * @param env - environment values (defaults to `process.env`).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env['PORT'] ?? 3001);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('Invalid PORT: must be an integer between 1 and 65535');
  }

  const logLevel = (env['LOG_LEVEL'] ?? 'info') as ApiConfig['logLevel'];
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error('Invalid LOG_LEVEL: must be one of debug, info, warn, error');
  }

  const sameSite = (env['COOKIE_SAME_SITE'] ?? 'lax') as CookieConfig['sameSite'];
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    throw new Error('Invalid COOKIE_SAME_SITE: must be one of lax, strict, none');
  }

  const maxAgeSeconds = Number(env['SESSION_MAX_AGE_SECONDS'] ?? 28_800);
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error('Invalid SESSION_MAX_AGE_SECONDS: must be a positive integer');
  }

  return {
    port,
    host: env['HOST'] ?? '0.0.0.0',
    databaseUrl: required(env, 'DATABASE_URL'),
    autoMigrate: env['DATABASE_AUTO_MIGRATE'] !== 'false',
    webOrigin: required(env, 'WEB_ORIGIN', 'http://localhost:5173'),
    oidc: {
      issuerUrl: required(env, 'OIDC_ISSUER_URL', 'http://localhost:8080/realms/nexora'),
      clientId: required(env, 'OIDC_CLIENT_ID', 'nexora-web'),
      redirectUri: required(env, 'OIDC_REDIRECT_URI', 'http://localhost:3001/api/auth/callback'),
    },
    cookie: {
      name: env['COOKIE_NAME'] ?? 'nexora_session',
      sameSite,
      secure: env['COOKIE_SECURE'] === 'true',
      maxAgeSeconds,
    },
    ai: {
      groqApiKey: env['GROQ_API_KEY'] === undefined ? undefined : env['GROQ_API_KEY'],
      model: env['AI_MODEL']?.trim() || 'llama-3.3-70b-versatile',
    },
    integrations: {
      // REQUIRED (S21 finding IN-04): no hardcoded default — a deployment
      // that omits the var fails fast instead of signing inbound actions
      // with a publicly-known secret.
      inboundSecret: required(env, 'INTEGRATIONS_INBOUND_SECRET'),
    },
    s3: loadS3Config(env),
    logLevel,
  };
}

/**
 * Loads the optional S3/MinIO storage configuration. When `S3_ENDPOINT` is
 * not set the container uses the in-memory storage port (no durable
 * documents); set all S3_* values to enable durable content storage.
 */
function loadS3Config(env: NodeJS.ProcessEnv): S3Config | undefined {
  const endPoint = env['S3_ENDPOINT']?.trim();
  if (endPoint === undefined || endPoint.length === 0) {
    return undefined;
  }
  const port = Number(env['S3_PORT'] ?? 9000);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('Invalid S3_PORT: must be an integer between 1 and 65535');
  }
  return {
    endPoint,
    port,
    useSSL: env['S3_USE_SSL'] === 'true',
    accessKey: required(env, 'S3_ACCESS_KEY'),
    secretKey: required(env, 'S3_SECRET_KEY'),
    bucket: env['S3_BUCKET']?.trim() || 'nexora-documents',
  };
}
