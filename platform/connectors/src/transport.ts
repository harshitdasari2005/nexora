/**
 * @nexora/connectors — provider HTTP transport.
 *
 * The injectable seam between a connector and the provider's HTTP API
 * (S25 Phase 7). The engine never constructs provider calls itself —
 * each provider implementation uses a {@link ConnectorHttpTransport}, so
 * contract tests inject deterministic fixtures and the real stack uses the
 * fetch-based default. Credentials are carried ONLY by the transport (the
 * configured connection), never by tool arguments.
 */

/** A provider HTTP request. */
export interface ConnectorHttpRequest {
  /** HTTP method. */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The full provider URL. */
  url: string;
  /** Request headers (authorization is added by the connector). */
  headers?: Record<string, string>;
  /** Optional JSON body. */
  body?: unknown;
}

/** A provider HTTP response (JSON body already parsed). */
export interface ConnectorHttpResponse {
  /** HTTP status code. */
  status: number;
  /** The parsed JSON body (or `undefined` when empty/non-JSON). */
  body: unknown;
}

/**
 * The provider HTTP transport contract. Implementations never see tool
 * arguments — they carry the connection credentials configured at build
 * time. This is the single seam contract tests replace with fixtures.
 */
export interface ConnectorHttpTransport {
  /** Performs a provider HTTP request. */
  request(input: ConnectorHttpRequest): Promise<ConnectorHttpResponse>;
}

/** A transport failure (network error, DNS, timeout) — provider unavailable. */
export class ProviderTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderTransportError';
  }
}

/**
 * The default transport: Node's global `fetch`. Response bodies are parsed
 * as JSON when the content type allows; non-JSON bodies surface as
 * `undefined`. Network failures throw {@link ProviderTransportError} (the
 * provider layer maps it to `PROVIDER_UNAVAILABLE`).
 */
export class FetchConnectorTransport implements ConnectorHttpTransport {
  async request(input: ConnectorHttpRequest): Promise<ConnectorHttpResponse> {
    let response: Response;
    try {
      response = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new ProviderTransportError(
        error instanceof Error ? error.message : 'Provider request failed',
      );
    }
    const text = await response.text();
    let body: unknown = undefined;
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = undefined;
      }
    }
    return { status: response.status, body };
  }
}
