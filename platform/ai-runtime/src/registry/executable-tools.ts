/**
 * @nexora/ai-runtime — executable tool registry.
 *
 * The runtime-facing table of *executable* tools (AIR.md §10 Tool Runtime):
 * `Tool` instances from the Agent SDK, resolved by id by the
 * {@link ToolExecutor}. This is distinct from the canonical
 * `ToolRegistryEntry` metadata in the {@link RuntimeRegistry} — metadata is
 * for discovery; this registry holds the callable implementations.
 */

import type { Tool } from '@nexora/agent-sdk/tools';

/** In-memory registry of executable tools keyed by tool id. */
export class ExecutableToolRegistry {
  readonly #tools = new Map<string, Tool<unknown, unknown>>();

  /** Registers a tool. Throws on duplicate ids. */
  register(tool: Tool<unknown, unknown>): void {
    if (this.#tools.has(tool.manifest.id)) {
      throw new Error(`Tool already registered: ${tool.manifest.id}`);
    }
    this.#tools.set(tool.manifest.id, tool);
  }

  /** Returns the registered tool, or `undefined`. */
  resolve(id: string): Tool<unknown, unknown> | undefined {
    return this.#tools.get(id);
  }

  /** All registered tool ids. */
  ids(): readonly string[] {
    return [...this.#tools.keys()];
  }

  /** The number of registered tools. */
  get size(): number {
    return this.#tools.size;
  }
}
