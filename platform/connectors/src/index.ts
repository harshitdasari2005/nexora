/**
 * @nexora/connectors — external connector engine (S25 Phase 7).
 *
 * The generic, domain-agnostic connector surface for external business
 * systems. The engine is pure contract + registry + error/transport seams —
 * no business logic and no provider specifics. GitHub/Slack (and future
 * providers) implement the {@link ExternalConnector} contract and register
 * through the {@link ConnectorRegistry}; the apps layer wires the registry
 * into the existing capability-aware AI discovery and the governed Nexora
 * MCP tool surface. Every connector operation still passes Nexora
 * authorization, approval (for writes), verification, and audit — a
 * connector is an adapter, never a privilege-escalation mechanism.
 */

export type {
  ConnectorExecutionContext,
  ConnectorOperationType,
  ConnectorTool,
  ConnectorToolResult,
  ExternalConnector,
} from './connector.js';
export { ConnectorRegistry, type ResolvedConnectorTool } from './registry.js';
export {
  CONNECTOR_ERROR_CODES,
  connectorFailure,
  providerStatusToErrorCode,
  type ConnectorError,
  type ConnectorErrorCode,
} from './errors.js';
export {
  FetchConnectorTransport,
  ProviderTransportError,
  type ConnectorHttpRequest,
  type ConnectorHttpResponse,
  type ConnectorHttpTransport,
} from './transport.js';
