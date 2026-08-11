/**
 * @nexora/agent-sdk — testing support.
 *
 * Testing utilities for building and exercising agents in unit tests:
 * mocks, fakes, and factories. Only for tests — not part of the runtime
 * surface.
 */

import type { AgentManifest } from '@nexora/contracts/ai';
import type { Result } from '@nexora/shared/result';

import { BaseAgent, type AgentDependencies } from '../base/index.js';
import type { ExecutionContext } from '../contexts/index.js';
import type { MemoryItem, MemoryProvider, MemorySnapshot } from '../memory/index.js';
import type { SkillInput, SkillManifest, SkillOutput } from '../skills/index.js';
import type { ToolExecutionContext, ToolManifest, ToolResult } from '../tools/index.js';
import type { ExecutionFailure } from '../types/index.js';

/**
 * Builds a minimal, valid agent manifest for tests.
 *
 * @param overrides - optional manifest field overrides.
 */
export function testManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    identity: { id: 'agt_test', name: 'test', displayName: 'Test Agent' },
    version: '1.0.0',
    skills: [],
    tools: [],
    knowledgeScopes: [],
    policyIds: [],
    emittedEventTypes: [],
    subscribedEventTypes: [],
    updatedAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * A configurable mock agent for tests. The `handler` decides the execution
 * outcome.
 */
export class MockAgent extends BaseAgent<string, string> {
  /** Number of executions performed. */
  executions = 0;

  /**
   * @param manifest    - the agent manifest.
   * @param handler     - optional result handler; defaults to success.
   * @param dependencies - additional dependencies (logger, metrics, ...).
   */
  constructor(
    manifest: AgentManifest = testManifest(),
    private readonly handler?: (
      input: string,
    ) => Result<string, ExecutionFailure> | Promise<Result<string, ExecutionFailure>>,
    dependencies: Partial<AgentDependencies> = {},
  ) {
    super({ ...dependencies, manifest });
  }

  protected async execute(
    input: string,
    _context: ExecutionContext,
  ): Promise<Result<string, ExecutionFailure>> {
    this.executions += 1;
    if (this.handler !== undefined) {
      return this.handler(input);
    }
    return { ok: true, value: `handled:${input}` };
  }
}

/** A configurable mock tool for tests. */
export class MockTool {
  readonly manifest: ToolManifest;
  /** Number of invocations. */
  invocations = 0;

  /**
   * @param manifest - the tool manifest.
   * @param handler  - optional result handler; defaults to success.
   */
  constructor(
    manifest: ToolManifest,
    private readonly handler?: (input: Record<string, unknown>) => ToolResult<unknown>,
  ) {
    this.manifest = manifest;
  }

  /** Invokes the mock tool. */
  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolResult<unknown>> {
    this.invocations += 1;
    if (this.handler !== undefined) {
      return this.handler(input);
    }
    return { ok: true, output: { echoed: input }, completedAt: new Date().toISOString() };
  }
}

/** A configurable mock skill for tests. */
export class MockSkill {
  readonly manifest: SkillManifest;
  /** Number of executions. */
  executions = 0;

  /**
   * @param manifest - the skill manifest.
   * @param handler  - optional result handler; defaults to success.
   */
  constructor(
    manifest: SkillManifest,
    private readonly handler?: (input: SkillInput) => SkillOutput<unknown>,
  ) {
    this.manifest = manifest;
  }

  /** Executes the mock skill. */
  async execute(input: SkillInput): Promise<SkillOutput<unknown>> {
    this.executions += 1;
    if (this.handler !== undefined) {
      return this.handler(input);
    }
    return { ok: true, output: { handled: input.args } };
  }
}

/**
 * Builds a valid fake execution context for tests.
 */
export function fakeExecutionContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    executionId: `exe_${overrides.executionId ?? 'test'}`,
    agentId: 'agt_test',
    tenantId: 'tenant_1',
    startedAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  } as ExecutionContext;
}

/** An in-memory memory provider for tests. */
export class FakeMemoryProvider implements MemoryProvider {
  readonly items: MemoryItem[] = [];

  /** Stores an item in the in-memory store. */
  async store(item: MemoryItem): Promise<void> {
    this.items.push(item);
  }

  /** Returns all stored items (retrieval is a simple filter). */
  async retrieve(): Promise<{ items: readonly MemoryItem[]; servedAt: string }> {
    return { items: [...this.items], servedAt: new Date().toISOString() };
  }

  /** Captures a snapshot of the stored items. */
  async snapshot(): Promise<MemorySnapshot> {
    return { agentId: 'agt_test', items: [...this.items], takenAt: new Date().toISOString() };
  }
}
