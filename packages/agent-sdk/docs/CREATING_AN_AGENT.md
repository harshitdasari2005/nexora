# Creating a New Agent

Step-by-step guide to building a Nexora agent on the Agent SDK.

## 1. Write the manifest

The manifest declares the agent's identity, version, skills, tools, knowledge scopes,
and policies (canonical `AgentManifest` from `@nexora/contracts/ai`). Use
`ManifestBuilder` for fluency:

```ts
import { ManifestBuilder } from '@nexora/agent-sdk/builders';

const manifest = new ManifestBuilder('hr', '1.0.0')
  .displayName('HR Agent')
  .withSkill('skills.hire_employee')
  .withTool('tools.create_employee')
  .withKnowledgeScope('hr/policies')
  .withPolicy('hr-execution-policy')
  .withEmittedEvent('employee.created')
  .build();
```

## 2. Extend `BaseAgent`

```ts
import { BaseAgent } from '@nexora/agent-sdk/base';
import { ApprovalRequestBuilder } from '@nexora/agent-sdk/approval';
import type { ExecutionContext } from '@nexora/agent-sdk/contexts';
import type { ExecutionFailure } from '@nexora/agent-sdk/types';
import type { ApprovalResult } from '@nexora/agent-sdk/approval';
import type { ApprovalRequest } from '@nexora/contracts/approval';
import { ok, type Result } from '@nexora/shared/result';

// The approval-engine port is defined by the domain (contracts/); the SDK
// only defines the ApprovalResult contract the engine must return.
type ApprovalEnginePort = {
  submit(request: ApprovalRequest): Promise<ApprovalResult>;
};

interface HireInput {
  name: string;
  role: string;
}
interface HireOutput {
  employeeId: string;
}

export class HrAgent extends BaseAgent<HireInput, HireOutput> {
  // Register skills/tools once, in the constructor or a factory.
  constructor(
    deps: AgentDependencies,
    private readonly approvalEngine: ApprovalEnginePort,
  ) {
    super(deps);
    this.skills.register(new HireEmployeeSkill(/* injected ports */));
  }

  // The only mandatory hook: the core work.
  protected async execute(
    input: HireInput,
    _ctx: ExecutionContext,
  ): Promise<Result<HireOutput, ExecutionFailure>> {
    const result = await this.skills.execute('skills.hire_employee', input);
    if (!result.ok) return result; // typed failure propagates
    return ok({ employeeId: result.output.employeeId });
  }

  // Consequential actions require human approval (AIR.md §12).
  protected override async shouldRequireApproval(input: HireInput): Promise<boolean> {
    return input.role === 'executive';
  }

  protected override async requestApproval(input: HireInput): Promise<ApprovalResult> {
    // Build a canonical approval request (AIR.md §12.1) and raise it through
    // the platform's Approval Engine; the engine answers with the result.
    const request = new ApprovalRequestBuilder(
      `agent:hr`, // source id
      `Hire ${input.name} as ${input.role}`, // summary
    )
      .requiringRole('hr.executive-approver')
      .withContext({ candidate: input.name, role: input.role })
      .build();
    return this.approvalEngine.submit(request); // injected port
  }
}
```

## 3. Register and run

```ts
const agent = new HrAgent({ manifest, metrics: otelRecorder, policies: policyEngine });
agent.markReady();
const result = await agent.run({ name: 'Sarah', role: 'engineer' }, executionContext());
if (result.ok) {
  // result.output.employeeId
} else {
  // result.code === 'APPROVAL_REJECTED' | 'BUSINESS_RULE_VIOLATION' | ...
}
```

## 4. Expose capabilities

Register each agent capability (the discovery surface Enterprise AI uses):

```ts
agent.capabilities.register({
  manifest: new CapabilityBuilder('hr.hire_employee')
    .withDescription('Hire an employee and assign them to a project')
    .withAutonomyTier('supervised')
    .withSideEffect('write')
    .build(),
  execute: async (input, ctx) => this.execute(input, ctx),
});
```

## Rules of thumb

- **No business logic in the agent shell** — delegate to skills; skills delegate to
  domain application services (via injected ports).
- **Never import a domain from the SDK** — domains depend on the SDK, never the reverse.
- **Return failures, don't throw** — throw only for unexpected bugs.
- **Keep the agent generic** — domain-specific behavior belongs in skills/tools/policies.
