/**
 * @nexora/mcp — Nexora-owned MCP server engine (S24 Phase 5).
 *
 * A generic, capability-aware adapter over the standard Model Context
 * Protocol: the engine exposes the trusted execution context, the tool
 * definition contract, capability-aware discovery, and the stdio server.
 * The engine contains no business logic — apps compose it with canonical
 * Agent SDK tools (native adapter) and the same tools exposed as MCP tools
 * (MCP adapter), one canonical definition, two adapters.
 */

export * from './context.js';
export * from './tool.js';
export * from './discovery.js';
export * from './errors.js';
export * from './server.js';
