/**
 * @nexora/ai-runtime — adapters.
 *
 * Provider adapter placeholders (Phase 1). Each adapter declares its
 * contract shape (the {@link ModelProvider} interface) and fails loudly with
 * a {@link ProviderError} until the transport is wired (ADR-008). No vendor
 * SDK is imported; the runtime stays provider-independent.
 */

export * from './anthropic-adapter.js';
export * from './groq-adapter.js';
export * from './ollama-adapter.js';
export * from './openai-adapter.js';
