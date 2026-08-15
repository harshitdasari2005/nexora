/**
 * @nexora/app-api — Slack connector (S25 Phase 7).
 *
 * An implementation of the generic {@link ExternalConnector} contract for
 * the Slack Web API. Like the GitHub connector it is a REGISTERED PROVIDER,
 * never the architecture: credentials are injected at construction and live
 * only in the transport; tool input schemas reject any credential/identity/
 * scope field.
 *
 * Tools:
 * - slack.channels.list     (read)  — the workspace's accessible channels
 * - slack.messages.recent   (read)  — recent messages in a channel
 * - slack.messages.send     (write) — send a message, then VERIFY the
 *   provider response carries the message identifier (ts) before reporting
 *   success (never a bare HTTP 200).
 *
 * Slack API semantics: the Web API returns HTTP 200 with `{ ok: false,
 * error: "..." }` for API-level failures. The connector treats that as a
 * failure and maps the Slack error string to a stable Nexora connector
 * code — raw provider internals are never surfaced.
 */

import {
  CONNECTOR_ERROR_CODES,
  connectorFailure,
  type ConnectorError,
  type ConnectorExecutionContext,
  type ConnectorHttpTransport,
  type ConnectorTool,
  type ConnectorToolResult,
  type ExternalConnector,
  FetchConnectorTransport,
} from '@nexora/connectors';

/** The Slack Web API base URL. */
const SLACK_API_BASE = 'https://slack.com/api';

/** Reads a safe string from an unknown JSON body. */
function readString(body: unknown, key: string): string | undefined {
  if (body === null || typeof body !== 'object') {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(body: unknown, key: string): boolean | undefined {
  if (body === null || typeof body !== 'object') {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** Slack authentication: Bearer token on every request. */
function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** The stable capability ids served by the Slack connector. */
export const SLACK_CAPABILITIES = [
  'slack.channels.read',
  'slack.messages.read',
  'slack.messages.send',
] as const;

/** A shared strict schema helper: no identity/scope/credential fields. */
function objectSchema(properties: Record<string, unknown>, required: readonly string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

/** Options of {@link SlackConnector}. */
export interface SlackConnectorOptions {
  /** The connection token (from the configured connection, never tool input). */
  token: string;
  /** The provider HTTP transport (injectable for contract tests). */
  transport?: ConnectorHttpTransport;
}

/**
 * The Slack connector: implements the generic connector contract over the
 * Slack Web API.
 */
export class SlackConnector implements ExternalConnector {
  readonly id = 'slack';
  readonly name = 'Slack';
  readonly provider = 'slack';
  readonly capabilities: readonly string[] = SLACK_CAPABILITIES;
  readonly tools: readonly ConnectorTool[];
  readonly #transport: ConnectorHttpTransport;
  readonly #token: string;

  constructor(options: SlackConnectorOptions) {
    this.#token = options.token;
    this.#transport = options.transport ?? new FetchConnectorTransport();
    this.tools = [
      {
        id: 'slack.channels.list',
        name: 'List Slack channels',
        description: 'Lists the Slack channels the connected account can access',
        inputSchema: objectSchema({}),
        requiredCapability: 'slack.channels.list',
        operationType: 'read',
        requiresApproval: false,
        timeoutMs: 15_000,
        execute: (input, context) => this.#listChannels(input, context),
      },
      {
        id: 'slack.messages.recent',
        name: 'List recent Slack messages',
        description: 'Lists the recent messages in a Slack channel',
        inputSchema: objectSchema(
          {
            channel: { type: 'string', minLength: 1, maxLength: 200 },
            limit: { type: 'integer', minimum: 1, maximum: 50 },
          },
          ['channel'],
        ),
        requiredCapability: 'slack.messages.recent',
        operationType: 'read',
        requiresApproval: false,
        timeoutMs: 15_000,
        execute: (input, context) => this.#recentMessages(input, context),
      },
      {
        id: 'slack.messages.send',
        name: 'Send Slack message',
        description: 'Sends a message to a Slack channel and verifies delivery',
        inputSchema: objectSchema(
          {
            channel: { type: 'string', minLength: 1, maxLength: 200 },
            text: { type: 'string', minLength: 1, maxLength: 4000 },
          },
          ['channel', 'text'],
        ),
        requiredCapability: 'slack.messages.send',
        operationType: 'write',
        requiresApproval: true,
        timeoutMs: 30_000,
        execute: (input, context) => this.#sendMessage(input, context),
      },
    ];
  }

  resolveTool(toolId: string): ConnectorTool | undefined {
    return this.tools.find((tool) => tool.id === toolId);
  }

  async #listChannels(
    input: Record<string, unknown>,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorToolResult> {
    const response = await this.#request(
      'GET',
      `${SLACK_API_BASE}/conversations.list?types=public_channel,private_channel&limit=200`,
      context,
    );
    const outcome = this.#okOutcome(response);
    if (!outcome.ok) {
      return outcome;
    }
    const body = response.body as Record<string, unknown>;
    const channels = Array.isArray(body.channels)
      ? (body.channels as unknown[])
          .map((channel) => ({
            id: readString(channel, 'id'),
            name: readString(channel, 'name'),
            isPrivate: readBoolean(channel, 'is_private') ?? false,
            isMember: readBoolean(channel, 'is_member') ?? false,
          }))
          .filter((channel) => channel.id !== undefined && channel.name !== undefined)
      : [];
    return { ok: true, output: { channels, count: channels.length } };
  }

  async #recentMessages(
    input: Record<string, unknown>,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorToolResult> {
    const channel = encodeURIComponent(String(input.channel ?? ''));
    const limit = typeof input.limit === 'number' ? Math.min(Math.max(1, input.limit), 50) : 10;
    const response = await this.#request(
      'GET',
      `${SLACK_API_BASE}/conversations.history?channel=${channel}&limit=${limit}`,
      context,
    );
    const outcome = this.#okOutcome(response);
    if (!outcome.ok) {
      return outcome;
    }
    const body = response.body as Record<string, unknown>;
    const messages = Array.isArray(body.messages)
      ? (body.messages as unknown[])
          .map((message) => ({
            ts: readString(message, 'ts'),
            user: readString(message, 'user'),
            text: readString(message, 'text'),
            type: readString(message, 'type'),
          }))
          .filter((message) => message.ts !== undefined)
      : [];
    return { ok: true, output: { messages, count: messages.length } };
  }

  async #sendMessage(
    input: Record<string, unknown>,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorToolResult> {
    const sent = await this.#request('POST', `${SLACK_API_BASE}/chat.postMessage`, context, {
      channel: String(input.channel ?? ''),
      text: String(input.text ?? ''),
    });
    const outcome = this.#okOutcome(sent);
    if (!outcome.ok) {
      return outcome;
    }
    // Verification: the provider response must carry the message identifier
    // (ts) + channel — a bare HTTP 200 is never reported as success.
    const body = sent.body as Record<string, unknown>;
    const ts = readString(body, 'ts');
    const channel = readString(body, 'channel');
    if (ts === undefined || channel === undefined) {
      return connectorFailure(
        CONNECTOR_ERROR_CODES.VERIFICATION_FAILED,
        'The message was sent but the provider did not return a message identifier',
      );
    }
    return {
      ok: true,
      output: {
        message: {
          ts,
          channel,
          ok: readBoolean(body, 'ok') ?? true,
        },
      },
    };
  }

  /**
   * Interprets a Slack Web API response: HTTP-level transport failures and
   * `{ ok: false }` bodies map to stable connector codes. Returns
   * `{ ok: true }` for a successful response body.
   */
  #okOutcome(response: { status: number; body: unknown }): { ok: true } | ConnectorToolResult {
    if (response.status !== 200) {
      return this.#failure(this.#httpCode(response.status));
    }
    const body = response.body as Record<string, unknown>;
    const ok = readBoolean(body, 'ok') ?? false;
    if (!ok) {
      const slackError = readString(body, 'error');
      return this.#failure(this.#slackCode(slackError));
    }
    return { ok: true };
  }

  /** Maps a non-200 HTTP status to a stable code. */
  #httpCode(status: number): ConnectorError['code'] {
    if (status === 401) {
      return CONNECTOR_ERROR_CODES.PROVIDER_AUTH_FAILED;
    }
    if (status === 429) {
      return CONNECTOR_ERROR_CODES.PROVIDER_RATE_LIMITED;
    }
    return CONNECTOR_ERROR_CODES.PROVIDER_UNAVAILABLE;
  }

  /** Maps a Slack API error string to a stable Nexora code. */
  #slackCode(error: string | undefined): ConnectorError['code'] {
    switch (error) {
      case 'invalid_auth':
      case 'not_authed':
        return CONNECTOR_ERROR_CODES.PROVIDER_AUTH_FAILED;
      case 'channel_not_found':
      case 'conversation_not_found':
        return CONNECTOR_ERROR_CODES.PROVIDER_NOT_FOUND;
      case 'missing_scope':
      case 'not_in_channel':
      case 'restricted_action':
      case 'is_archived':
        return CONNECTOR_ERROR_CODES.PROVIDER_PERMISSION_DENIED;
      case 'ratelimited':
        return CONNECTOR_ERROR_CODES.PROVIDER_RATE_LIMITED;
      default:
        return CONNECTOR_ERROR_CODES.PROVIDER_UNAVAILABLE;
    }
  }

  #failure(code: ConnectorError['code']): ConnectorToolResult {
    return connectorFailure(code, this.#messageFor(code));
  }

  #messageFor(code: ConnectorError['code']): string {
    switch (code) {
      case CONNECTOR_ERROR_CODES.PROVIDER_AUTH_FAILED:
        return 'The Slack connection could not authenticate';
      case CONNECTOR_ERROR_CODES.PROVIDER_PERMISSION_DENIED:
        return 'The Slack account is not permitted to perform this operation';
      case CONNECTOR_ERROR_CODES.PROVIDER_NOT_FOUND:
        return 'The requested Slack resource was not found';
      case CONNECTOR_ERROR_CODES.PROVIDER_RATE_LIMITED:
        return 'Slack rate-limited the request';
      default:
        return 'The Slack provider is unavailable';
    }
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
        headers: {
          ...authHeaders(this.#token),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
        },
        body,
      });
    } catch {
      return { status: 503, body: undefined };
    }
  }
}
