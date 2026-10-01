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

/**
 * Which model provider serves narration.
 *
 * - `none`  — no provider registered; the deterministic composer narrates
 *             and NO prompt content leaves the process at all.
 * - `groq`  — hosted Groq API (prompt content transits a third party).
 * - `local` — any OpenAI-compatible endpoint you host yourself (Ollama,
 *             vLLM, LM Studio, TGI). Prompt content stays inside your own
 *             network — the data-residency option.
 */
export type AiProviderKind = 'none' | 'groq' | 'local';

/** Enterprise AI Runtime configuration. */
export interface AiConfig {
  /** The selected narration provider. */
  provider: AiProviderKind;
  /** The model id served by the provider (e.g. `llama-3.3-70b-versatile`, `llama3`). */
  model: string;
  /** Bearer token for the provider, when it requires one. */
  apiKey?: string;
  /** Base URL override (required in practice for `local`). */
  baseUrl?: string;
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

/** Runtime observability configuration. */
export interface ObservabilityConfig {
  /**
   * TRUSTED, versioned model pricing JSON (`{version,currency,models:{"provider/model":{promptPer1k,completionPer1k}}}`).
   * Absent → cost is `null`; Nexora never invents pricing.
   */
  modelPricingJson?: string;
}

/** External connector credentials (S25 Phase 7 — environment only). */
export interface ConnectorsConfig {
  /** GitHub personal-access token (the GitHub connection credential). */
  githubToken?: string;
  /** Slack bot/user token (the Slack connection credential). */
  slackToken?: string;
  /**
   * The tenant (organization) that owns the env-configured connections in
   * local development. REQUIRED to register the connections: without it no
   * connector is registered (fail closed — a connector never serves a
   * tenant it is not bound to). Production OAuth/account connections are a
   * later phase.
   */
  tenantId?: string;
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
/** Demo-mode configuration. */
export interface DemoConfig {
  /** Explicit opt-in (NEXORA_DEMO_MODE=true). Never enabled by default. */
  enabled: boolean;
}

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
  /** External connector credentials + tenant binding (S25 Phase 7). */
  connectors: ConnectorsConfig;
  /**
   * Runtime observability (Prompt 7). Optional so existing hand-built configs
   * keep compiling.
   */
  observability?: ObservabilityConfig;
  /**
   * S3/MinIO object storage. `undefined` when S3_ENDPOINT is not set — the
   * container then falls back to the in-memory storage port (local dev
   * without MinIO). Durable content requires S3 configured.
   */
  s3: S3Config | undefined;
  /**
   * Demo mode (final demo experience). Optional so existing hand-built configs
   * keep compiling; absent means DISABLED. When disabled the demo routes do not
   * exist (404) and normal authentication is unchanged.
   */
  demo?: DemoConfig;
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
 * Resolves the AI provider from the environment.
 *
 * `AI_PROVIDER` is authoritative when set. When absent, the legacy behavior
 * is preserved: a non-empty `GROQ_API_KEY` selects Groq, anything else falls
 * back to deterministic narration — so an existing deployment that never
 * heard of `AI_PROVIDER` keeps working unchanged, and a deployment that
 * configures nothing never silently starts sending tenant data anywhere.
 */
export function resolveAiProvider(env: NodeJS.ProcessEnv): AiProviderKind {
  const declared = env['AI_PROVIDER']?.trim().toLowerCase() ?? '';
  if (declared === 'none' || declared === 'groq' || declared === 'local') {
    return declared;
  }
  if (declared.length > 0) {
    throw new Error(`Invalid AI_PROVIDER "${declared}": must be one of none, groq, local`);
  }
  return (env['GROQ_API_KEY']?.trim() ?? '').length > 0 ? 'groq' : 'none';
}

/** Builds the AI configuration, validating the selected provider's inputs. */
export function loadAiConfig(env: NodeJS.ProcessEnv): AiConfig {
  const provider = resolveAiProvider(env);
  const apiKey = (env['AI_API_KEY']?.trim() ?? '') || (env['GROQ_API_KEY']?.trim() ?? '');
  const baseUrl = env['AI_BASE_URL']?.trim() ?? '';
  const model = env['AI_MODEL']?.trim() || 'llama-3.3-70b-versatile';

  // Fail fast on a provider that cannot possibly serve a completion, rather
  // than degrading to deterministic narration on the first user request and
  // leaving the operator to guess why.
  if (provider === 'groq' && apiKey.length === 0) {
    throw new Error('AI_PROVIDER=groq requires GROQ_API_KEY (or AI_API_KEY) to be set');
  }
  if (provider === 'local' && baseUrl.length === 0) {
    throw new Error(
      'AI_PROVIDER=local requires AI_BASE_URL, e.g. http://localhost:11434/v1 for Ollama',
    );
  }

  return {
    provider,
    model,
    ...(apiKey.length > 0 ? { apiKey } : {}),
    ...(baseUrl.length > 0 ? { baseUrl } : {}),
  };
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
    ai: loadAiConfig(env),
    integrations: {
      // REQUIRED (S21 finding IN-04): no hardcoded default — a deployment
      // that omits the var fails fast instead of signing inbound actions
      // with a publicly-known secret.
      inboundSecret: required(env, 'INTEGRATIONS_INBOUND_SECRET'),
    },
    connectors: {
      githubToken: env['GITHUB_TOKEN']?.trim() || undefined,
      slackToken: env['SLACK_TOKEN']?.trim() || undefined,
      tenantId: env['CONNECTOR_TENANT_ID']?.trim() || undefined,
    },
    observability: { modelPricingJson: env['NEXORA_MODEL_PRICING']?.trim() || undefined },
    s3: loadS3Config(env),
    demo: { enabled: env['NEXORA_DEMO_MODE'] === 'true' },
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
