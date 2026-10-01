/**
 * @nexora/app-api — GitHub connector (S25 Phase 7).
 *
 * An implementation of the generic {@link ExternalConnector} contract for
 * the GitHub REST API. It is NOT the architecture — it is a registered
 * provider. Credentials (the connection token) are injected at construction
 * from the configured connection and live ONLY in the transport; tool input
 * schemas reject any credential/identity/scope field (strict schemas,
 * `additionalProperties: false`).
 *
 * Tools:
 * - github.repositories.list  (read)  — the authenticated user's repositories
 * - github.repositories.get   (read)  — one repository (owner/repo)
 * - github.issues.list        (read)  — issues of a repository
 * - github.issues.create      (write) — create an issue, then VERIFY by
 *   reading the created issue back from the provider (never trust a bare
 *   HTTP 200/201 — a write is only reported as succeeded after the
 *   read-back confirms the persisted provider state).
 *
 * Every operation maps provider failures to stable Nexora connector error
 * codes; raw provider internals are never surfaced.
 */

import {
  CONNECTOR_ERROR_CODES,
  connectorFailure,
  providerStatusToErrorCode,
  type ConnectorError,
  type ConnectorExecutionContext,
  type ConnectorHttpTransport,
  type ConnectorTool,
  type ConnectorToolResult,
  type ExternalConnector,
  FetchConnectorTransport,
} from '@nexora/connectors';

/** The GitHub REST API base URL. */
const GITHUB_API_BASE = 'https://api.github.com';

/** Reads a safe string from an unknown JSON body. */
function readString(body: unknown, key: string): string | undefined {
  if (body === null || typeof body !== 'object') {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * An owner / repository name: GitHub's own character set, and never the dot
 * segments `.` / `..` — `encodeURIComponent('..')` is `..`, which the URL parser
 * would collapse (`/repos/../user` → `/user`) and so reach other API paths
 * with the tenant's token.
 */
const GITHUB_NAME_PATTERN = '^(?!\\.{1,2}$)[A-Za-z0-9_.-]+$';

function readNumber(body: unknown, key: string): number | undefined {
  if (body === null || typeof body !== 'object') {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

function readBoolean(body: unknown, key: string): boolean | undefined {
  if (body === null || typeof body !== 'object') {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** GitHub authentication: Bearer token on every request. */
function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** The stable capability ids served by the GitHub connector. */
export const GITHUB_CAPABILITIES = [
  'github.repositories.read',
  'github.issues.read',
  'github.issues.create',
] as const;

/** A shared strict schema helper: no identity/scope/credential fields. */
function objectSchema(properties: Record<string, unknown>, required: readonly string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

/** Options of {@link GitHubConnector}. */
export interface GitHubConnectorOptions {
  /** The connection token (from the configured connection, never tool input). */
  token: string;
  /** The provider HTTP transport (injectable for contract tests). */
  transport?: ConnectorHttpTransport;
}

/**
 * The GitHub connector: implements the generic connector contract over the
 * GitHub REST API.
 */
export class GitHubConnector implements ExternalConnector {
  readonly id = 'github';
  readonly name = 'GitHub';
  readonly provider = 'github';
  readonly capabilities: readonly string[] = GITHUB_CAPABILITIES;
  readonly tools: readonly ConnectorTool[];
  readonly #transport: ConnectorHttpTransport;
  readonly #token: string;

  constructor(options: GitHubConnectorOptions) {
    this.#token = options.token;
    this.#transport = options.transport ?? new FetchConnectorTransport();
    this.tools = [
      {
        id: 'github.repositories.list',
        name: 'List GitHub repositories',
        description: 'Lists the repositories the connected GitHub account can access',
        inputSchema: objectSchema({}),
        requiredCapability: 'github.repositories.list',
        operationType: 'read',
        requiresApproval: false,
        timeoutMs: 15_000,
        execute: (input, context) => this.#listRepositories(input, context),
      },
      {
        id: 'github.repositories.get',
        name: 'Get GitHub repository',
        description: 'Gets one GitHub repository by owner and repository name',
        inputSchema: objectSchema(
          {
            owner: { type: 'string', minLength: 1, maxLength: 100, pattern: GITHUB_NAME_PATTERN },
            repo: { type: 'string', minLength: 1, maxLength: 100, pattern: GITHUB_NAME_PATTERN },
          },
          ['owner', 'repo'],
        ),
        requiredCapability: 'github.repositories.get',
        operationType: 'read',
        requiresApproval: false,
        timeoutMs: 15_000,
        execute: (input, context) => this.#getRepository(input, context),
      },
      {
        id: 'github.issues.list',
        name: 'List GitHub issues',
        description: 'Lists the issues of a GitHub repository (optionally by state)',
        inputSchema: objectSchema(
          {
            owner: { type: 'string', minLength: 1, maxLength: 100, pattern: GITHUB_NAME_PATTERN },
            repo: { type: 'string', minLength: 1, maxLength: 100, pattern: GITHUB_NAME_PATTERN },
            state: { type: 'string', enum: ['open', 'closed', 'all'] },
          },
          ['owner', 'repo'],
        ),
        requiredCapability: 'github.issues.list',
        operationType: 'read',
        requiresApproval: false,
        timeoutMs: 15_000,
        execute: (input, context) => this.#listIssues(input, context),
      },
      {
        id: 'github.issues.create',
        name: 'Create GitHub issue',
        description: 'Creates an issue in a GitHub repository and verifies it was created',
        inputSchema: objectSchema(
          {
            owner: { type: 'string', minLength: 1, maxLength: 100, pattern: GITHUB_NAME_PATTERN },
            repo: { type: 'string', minLength: 1, maxLength: 100, pattern: GITHUB_NAME_PATTERN },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            body: { type: 'string', maxLength: 4000 },
          },
          ['owner', 'repo', 'title'],
        ),
        requiredCapability: 'github.issues.create',
        operationType: 'write',
        requiresApproval: true,
        timeoutMs: 30_000,
        execute: (input, context) => this.#createIssue(input, context),
      },
    ];
  }

  resolveTool(toolId: string): ConnectorTool | undefined {
    return this.tools.find((tool) => tool.id === toolId);
  }

  async #listRepositories(
    input: Record<string, unknown>,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorToolResult> {
    const response = await this.#request(
      'GET',
      `${GITHUB_API_BASE}/user/repos?per_page=100`,
      context,
    );
    if (response.status !== 200) {
      return this.#providerFailure(response.status);
    }
    if (!Array.isArray(response.body)) {
      return connectorFailure(
        CONNECTOR_ERROR_CODES.PROVIDER_UNAVAILABLE,
        'Invalid provider response',
      );
    }
    const repositories = response.body
      .map((repo) => ({
        name: readString(repo, 'name'),
        fullName: readString(repo, 'full_name'),
        htmlUrl: readString(repo, 'html_url'),
        private: readBoolean(repo, 'private') ?? false,
        defaultBranch: readString(repo, 'default_branch'),
        description: readString(repo, 'description'),
      }))
      .filter((repo) => repo.name !== undefined && repo.fullName !== undefined);
    return { ok: true, output: { repositories, count: repositories.length } };
  }

  async #getRepository(
    input: Record<string, unknown>,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorToolResult> {
    const owner = encodeURIComponent(String(input.owner ?? ''));
    const repo = encodeURIComponent(String(input.repo ?? ''));
    const response = await this.#request(
      'GET',
      `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
      context,
    );
    if (response.status !== 200) {
      return this.#providerFailure(response.status);
    }
    const body = response.body as Record<string, unknown>;
    return {
      ok: true,
      output: {
        repository: {
          name: readString(body, 'name'),
          fullName: readString(body, 'full_name'),
          htmlUrl: readString(body, 'html_url'),
          private: readBoolean(body, 'private') ?? false,
          defaultBranch: readString(body, 'default_branch'),
          description: readString(body, 'description'),
        },
      },
    };
  }

  async #listIssues(
    input: Record<string, unknown>,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorToolResult> {
    const owner = encodeURIComponent(String(input.owner ?? ''));
    const repo = encodeURIComponent(String(input.repo ?? ''));
    const state = typeof input.state === 'string' ? input.state : 'open';
    const response = await this.#request(
      'GET',
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?state=${state}&per_page=50`,
      context,
    );
    if (response.status !== 200) {
      return this.#providerFailure(response.status);
    }
    if (!Array.isArray(response.body)) {
      return connectorFailure(
        CONNECTOR_ERROR_CODES.PROVIDER_UNAVAILABLE,
        'Invalid provider response',
      );
    }
    const issues = response.body
      .map((issue) => ({
        number: readNumber(issue, 'number'),
        title: readString(issue, 'title'),
        state: readString(issue, 'state'),
        htmlUrl: readString(issue, 'html_url'),
        user: readString((issue as Record<string, unknown>)['user'], 'login'),
      }))
      .filter((issue) => issue.number !== undefined && issue.title !== undefined);
    return { ok: true, output: { issues, count: issues.length } };
  }

  async #createIssue(
    input: Record<string, unknown>,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorToolResult> {
    const owner = encodeURIComponent(String(input.owner ?? ''));
    const repo = encodeURIComponent(String(input.repo ?? ''));
    const created = await this.#request(
      'POST',
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues`,
      context,
      {
        title: String(input.title ?? ''),
        ...(typeof input.body === 'string' && input.body.length > 0 ? { body: input.body } : {}),
      },
    );
    if (created.status !== 201) {
      return this.#providerFailure(created.status);
    }
    const number = readNumber(created.body, 'number');

    // Verification: read the created issue back from the provider. A write
    // is never reported as succeeded on the bare create response alone.
    if (number === undefined) {
      return connectorFailure(
        CONNECTOR_ERROR_CODES.VERIFICATION_FAILED,
        'The issue was created but its provider identity could not be read back',
      );
    }
    const verified = await this.#request(
      'GET',
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${number}`,
      context,
    );
    if (verified.status !== 200) {
      return connectorFailure(
        CONNECTOR_ERROR_CODES.VERIFICATION_FAILED,
        'The created issue could not be verified with the provider',
      );
    }
    const body = verified.body as Record<string, unknown>;
    return {
      ok: true,
      output: {
        issue: {
          number,
          title: readString(body, 'title'),
          state: readString(body, 'state'),
          htmlUrl: readString(body, 'html_url'),
        },
      },
    };
  }

  /** Performs a provider request with the connection token. */
  async #request(
    method: 'GET' | 'POST',
    url: string,
    context: ConnectorExecutionContext,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    try {
      return await this.#transport.request({
        method,
        url,
        headers: authHeaders(this.#token),
        body,
      });
    } catch {
      return { status: 503, body: undefined };
    }
  }

  /** Maps a non-success provider status to a stable connector error. */
  #providerFailure(status: number): ConnectorToolResult {
    const code = providerStatusToErrorCode(status);
    const message = this.#messageFor(code);
    return connectorFailure(code, message);
  }

  #messageFor(code: ConnectorError['code']): string {
    switch (code) {
      case CONNECTOR_ERROR_CODES.PROVIDER_AUTH_FAILED:
        return 'The GitHub connection could not authenticate';
      case CONNECTOR_ERROR_CODES.PROVIDER_PERMISSION_DENIED:
        return 'The GitHub account is not permitted to perform this operation';
      case CONNECTOR_ERROR_CODES.PROVIDER_NOT_FOUND:
        return 'The requested GitHub resource was not found';
      case CONNECTOR_ERROR_CODES.PROVIDER_RATE_LIMITED:
        return 'GitHub rate-limited the request';
      default:
        return 'The GitHub provider is unavailable';
    }
  }
}
