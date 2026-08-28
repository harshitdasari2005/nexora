/**
 * @nexora/ai-runtime — provider adapters.
 *
 * Each adapter declares its contract shape (the {@link ModelProvider}
 * interface). `groq` (hosted) and `ollama` (self-hosted, or any
 * OpenAI-compatible endpoint) are wired over the shared transport in
 * `./openai-compatible-transport.js`; `openai` and `anthropic` remain
 * Phase 1 placeholders that fail loudly with a {@link ProviderError} until
 * their transports are wired (ADR-008). No vendor SDK is imported; the
 * runtime stays provider-independent.
 */

export * from './anthropic-adapter.js';
export * from './groq-adapter.js';
export * from './ollama-adapter.js';
export * from './openai-adapter.js';
export * from './openai-compatible-transport.js';
