/**
 * @nexora/module-detection — public surface (S27).
 *
 * The GENERIC proactive problem-detection + business-investigation engine:
 * deterministic business signals detect conditions from the TRUSTED snapshot
 * (existing application handlers), each detection maps to ONE durable
 * problem (dedupe by correlation identity), the generic investigation
 * gathers grounded evidence + root-cause candidates (FACT vs INFERENCE),
 * solution discovery searches EXISTING knowledge first (FOUND ≠ APPLICABLE,
 * never invented), and the deterministic recommendation produces a governed
 * S26 ActionProposal when a remediation capability is within the caller's
 * agent set. This barrel is the only import surface.
 *
 * Security contract (S27): the engine never decides tenant/workspace/role/
 * capability/authorization/approval — those come from the trusted context
 * and the S26 agent surface. Every problem read is tenant/workspace-scoped;
 * forged ids resolve to nothing; detection thresholds are deterministic
 * configuration, never LLM-decided; and the lifecycle transitions only
 * through the explicit deterministic table.
 */

export {
  DetectionError,
  DuplicateSignalError,
  InvalidSignalError,
  toDetectionError,
} from './errors.js';
export {
  BusinessSignalRegistry,
  type BusinessSignalDefinition,
  type SignalDetection,
  type SignalSeverity,
} from './registry/business-signal-registry.js';
export {
  DetectionApplicationService,
  GetProblemHandler,
  ListProblemsHandler,
  ScanProblemsHandler,
  type DetectionApplicationServiceDependencies,
  type DetectionScope,
  type ScanResult,
} from './application/detection-application-service.js';
export {
  BusinessProblem,
  DetectionStateTransitionError,
  buildCorrelationId,
  type BusinessProblemSnapshot,
  type ProblemAffectedEntity,
} from './domain/problem.js';
export {
  InvestigationEngine,
  type InvestigationOutcome,
} from './application/investigation-engine.js';
export {
  SolutionDiscovery,
  type DiscoveryOutcome,
  type ExecutionSolutionReference,
  type KnowledgeSolutionReference,
  type SolutionSources,
} from './application/solution-discovery.js';
export {
  type DetectionSnapshot,
  type DetectionSnapshotLoader,
  type SnapshotActivity,
  type SnapshotAgentExecution,
  type SnapshotNotification,
  type SnapshotOnboardingUser,
  type SnapshotProject,
  type SnapshotWorkflowHealth,
} from './application/detection-snapshot.js';
export type { ProblemStore } from './application/problem-store.js';
export { INITIAL_SIGNALS } from './seed/initial-signals.js';
