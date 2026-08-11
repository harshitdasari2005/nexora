/**
 * @nexora/ai-runtime — model provider.
 *
 * A provider that offers one or more model capabilities (chat, embedding,
 * streaming). The {@link ProviderRegistry} resolves providers by capability
 * so the runtime never couples to a vendor.
 */

import type { ChatProvider } from './chat-provider.js';
import type { EmbeddingProvider } from './embedding-provider.js';
import type { StreamingProvider } from './streaming-provider.js';

/** A model capability a provider may offer. */
export type ProviderCapability = 'chat' | 'embedding' | 'streaming';

/** A provider offering one or more model capabilities. */
export interface ModelProvider {
  /** Stable provider id, e.g. `openai`. */
  readonly id: string;
  /** Human-readable provider name. */
  readonly name: string;
  /** The capabilities this provider offers. */
  readonly capabilities: readonly ProviderCapability[];
  /** The models this provider can serve (ids). */
  readonly models: readonly string[];
  /** The chat capability, when offered. */
  readonly chat?: ChatProvider;
  /** The embedding capability, when offered. */
  readonly embedding?: EmbeddingProvider;
  /** The streaming capability, when offered. */
  readonly streaming?: StreamingProvider;
}
