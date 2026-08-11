/**
 * @nexora/ai-runtime — provider registry.
 *
 * Registers model providers and resolves them by id or capability (ADR-008
 * model abstraction). The runtime resolves a provider at call time — it
 * never hardcodes a vendor.
 */

import { ProviderError } from '../errors/index.js';
import type { ModelProvider, ProviderCapability } from './model-provider.js';

/** The model provider registry. */
export class ProviderRegistry {
  readonly #providers = new Map<string, ModelProvider>();

  /** Registers a provider. Throws on duplicate ids. */
  register(provider: ModelProvider): void {
    if (this.#providers.has(provider.id)) {
      throw new ProviderError(`Provider already registered: ${provider.id}`);
    }
    this.#providers.set(provider.id, provider);
  }

  /** Resolves a provider by id, or `undefined`. */
  resolve(id: string): ModelProvider | undefined {
    return this.#providers.get(id);
  }

  /** Resolves the first provider offering a capability, or `undefined`. */
  resolveByCapability(capability: ProviderCapability): ModelProvider | undefined {
    return [...this.#providers.values()].find((provider) =>
      provider.capabilities.includes(capability),
    );
  }

  /** Requires a provider offering a capability, or throws {@link ProviderError}. */
  require(capability: ProviderCapability): ModelProvider {
    const provider = this.resolveByCapability(capability);
    if (provider === undefined) {
      throw new ProviderError(`No provider offers the ${capability} capability`);
    }
    return provider;
  }

  /** All registered providers. */
  all(): readonly ModelProvider[] {
    return [...this.#providers.values()];
  }

  /** The number of registered providers. */
  get size(): number {
    return this.#providers.size;
  }
}
