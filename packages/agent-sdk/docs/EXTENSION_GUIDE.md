# Extension Guide

How to extend the SDK without modifying it (Open/Closed). Every extension point is
an interface or a strategy — the SDK itself stays generic.

## 1. Skills

Skills are the agent's unit of work (AIR.md §3). Register them on the agent's
`SkillRegistry`:

```ts
import type { Skill, SkillInput, SkillOutput, SkillManifest } from '@nexora/agent-sdk/skills';

const manifest: SkillManifest = {
  id: 'skills.hire_employee',
  name: 'hire_employee',
  description: 'Creates an employee record and assigns them to a project',
  capabilityIds: ['hr.hire_employee'],
  toolIds: ['tools.create_employee'],
  autonomyTier: 'supervised',
  requiresApproval: false,
};

const skill: Skill = {
  manifest,
  async execute(input: SkillInput): Promise<SkillOutput<unknown>> {
    // Delegate to the domain application service through an injected port.
    const employee = await hrService.createEmployee(input.args);
    return { ok: true, output: employee };
  },
};

agent.skills.register(skill);
```

Skills may use `agent.tools` and raise approvals; they must **not** import the SDK
base or domains directly — inject ports.

## 2. Tools

Tools are the atomic capability that skills and the planner call (AIR.md §10):

```ts
import type { Tool, ToolManifest } from '@nexora/agent-sdk/tools';

const tool: Tool = {
  manifest: {
    id: 'tools.create_employee',
    name: 'create_employee',
    description: 'Create an employee record',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  async execute(input, _ctx) {
    return { ok: true, output: await hrPort.createEmployee(input), completedAt: nowIso() };
  },
};

agent.tools.register(tool);
```

Tool execution is idempotency-aware: use `ToolExecutionContext` (carries the
correlation/execution id) to deduplicate.

## 3. Planning strategies

Provide a custom planner to convert intent into a `TaskGraph` (AIR.md §6):

```ts
import type { PlanningStrategy, PlanResult } from '@nexora/agent-sdk/planning';

class LazyPlanner implements PlanningStrategy {
  readonly name = 'lazy';
  plan(intent, context, constraints): PlanResult {
    /* ... */
  }
}
```

Keep strategies deterministic where possible; LLM-backed planners belong in the
platform, not in domain code.

## 4. Providers (memory, knowledge, policies, metrics)

All platform capabilities are injected, never imported:

```ts
import type { MemoryProvider } from '@nexora/agent-sdk/memory';
import type { KnowledgeProvider } from '@nexora/agent-sdk/knowledge';
import type { PolicyEvaluator } from '@nexora/agent-sdk/policies';
import type { MetricsRecorder } from '@nexora/agent-sdk/metrics';

const deps: AgentDependencies = {
  manifest,
  memory: myMemoryProvider, // MemoryProvider
  knowledge: myKnowledgeRuntime, // KnowledgeProvider
  policies: policyEngine, // PolicyEvaluator
  metrics: otelRecorder, // MetricsRecorder
  logger: createLogger({ service: 'agent:hr' }),
};
```

## 5. Builders

Fluent builders reduce boilerplate and keep manifests valid:

```ts
import {
  AgentBuilder,
  CapabilityBuilder,
  SkillBuilder,
  ToolBuilder,
} from '@nexora/agent-sdk/builders';

const agent = new AgentBuilder('hr', '1.0.0')
  .withSkill(new SkillBuilder('skills.hire_employee').withApproval().build())
  .withTool(new ToolBuilder('tools.create_employee').build())
  .build();
```

## 6. What NOT to extend

- Do not subclass `BaseAgent` for a _second_ base class — prefer composition
  (inject ports).
- Do not add business logic to `base/`, `contexts/`, `execution/`, or `types/` —
  these must remain domain-agnostic.
- Do not duplicate canonical contracts (`@nexora/contracts`) — re-export instead.
