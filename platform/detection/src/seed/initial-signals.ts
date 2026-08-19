/**
 * @nexora/module-detection — initial business signals (S27).
 *
 * The first five deterministic business signals. These are CONFIGURATION +
 * pure evaluators over the trusted detection snapshot — thresholds are
 * constants here, never LLM-decided. The generic detection engine runs each
 * registered signal; a future signal (e.g. `integration_failure`) registers
 * in the registry without touching the engine, the investigation, or the AI
 * Runtime.
 *
 * Determinism contract (S27): `evaluate` returns the detected conditions
 * ONLY when the deterministic thresholds are crossed. An LLM may explain a
 * detected condition later — it never decides whether the threshold was
 * crossed.
 */

import type {
  BusinessSignalDefinition,
  SignalDetection,
} from '../registry/business-signal-registry.js';

/** Workflow failure: any failed run, or a success rate below 75%. */
const WORKFLOW_FAILURE_MIN_SUCCESS_RATE = 75;

/** Workflow degradation: no hard failures but a success rate below 95%. */
const WORKFLOW_DEGRADATION_MAX_SUCCESS_RATE = 95;
/** Degradation needs enough runs to be meaningful. */
const WORKFLOW_DEGRADATION_MIN_RUNS = 3;

/** Onboarding delay: no first workflow after this many days. */
const ONBOARDING_DELAY_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Audit completeness: a tenant with executions but a traceable share < 100%. */
const AUDIT_COMPLETENESS_MIN_SHARE = 100;

/** The initial business-signal definitions (S27 registrations). */
export const INITIAL_SIGNALS: readonly BusinessSignalDefinition[] = [
  {
    id: 'workflow_failure',
    signalType: 'workflow_failure',
    name: 'Workflow failure',
    description:
      'A workflow definition has failed runs, or its success rate dropped below the deterministic threshold.',
    remediationCapabilities: ['workflow.retry_run', 'notifications.what_needs_attention'],
    evaluate: (snapshot) => {
      const detections: SignalDetection[] = [];
      for (const metric of snapshot.workflowHealth) {
        const failed = metric.failed >= 1;
        const degradedRate = metric.successRate < WORKFLOW_FAILURE_MIN_SUCCESS_RATE;
        if (!failed && !degradedRate) {
          continue;
        }
        detections.push({
          affectedEntity: {
            type: 'workflow',
            id: metric.definitionKey,
            title: metric.definitionKey,
          },
          severity: failed ? 'high' : 'medium',
          title: `${metric.definitionKey} requires attention`,
          description: failed
            ? `${metric.definitionKey} failed ${metric.failed} time(s) (${metric.unrecoverableErrorRate}% unrecoverable error rate).`
            : `${metric.definitionKey} has a ${metric.successRate}% success rate — below the ${WORKFLOW_FAILURE_MIN_SUCCESS_RATE}% threshold.`,
          facts: [
            `${metric.definitionKey} ran ${metric.total} time(s): ${metric.failed} failed, ${metric.successRate}% success rate.`,
          ],
          correlationSuffix: metric.definitionKey,
        });
      }
      return detections;
    },
  },
  {
    id: 'workflow_degradation',
    signalType: 'workflow_degradation',
    name: 'Workflow degradation',
    description:
      'A workflow definition is not failing outright but its success rate is below the healthy baseline with enough runs to measure.',
    remediationCapabilities: ['notifications.what_needs_attention'],
    evaluate: (snapshot) => {
      const detections: SignalDetection[] = [];
      for (const metric of snapshot.workflowHealth) {
        if (metric.failed >= 1) {
          // Hard failures are the failure signal's job — never double-report.
          continue;
        }
        if (metric.total < WORKFLOW_DEGRADATION_MIN_RUNS) {
          continue;
        }
        if (metric.successRate >= WORKFLOW_DEGRADATION_MAX_SUCCESS_RATE) {
          continue;
        }
        detections.push({
          affectedEntity: {
            type: 'workflow',
            id: metric.definitionKey,
            title: metric.definitionKey,
          },
          severity: 'medium',
          title: `${metric.definitionKey} is degrading`,
          description: `${metric.definitionKey} has a ${metric.successRate}% success rate across ${metric.total} run(s) — below the healthy ${WORKFLOW_DEGRADATION_MAX_SUCCESS_RATE}% baseline.`,
          facts: [
            `${metric.definitionKey} success rate is ${metric.successRate}% across ${metric.total} run(s) with no hard failures.`,
          ],
          correlationSuffix: metric.definitionKey,
        });
      }
      return detections;
    },
  },
  {
    id: 'project_attention',
    signalType: 'project_attention',
    name: 'Project attention',
    description:
      'Active projects exist but the caller has unread attention items — something in the project space may need a decision.',
    // Both capabilities are parameterless (deterministic execution through
    // the real orchestrator, same reasoning as `workflow_degradation`):
    // `projects.find_project` is deliberately NOT included here — it
    // requires a `name` input the remediation engine cannot supply.
    remediationCapabilities: ['notifications.what_needs_attention', 'notifications.mark_all_read'],
    evaluate: (snapshot) => {
      const activeProjects = snapshot.projects.filter((project) => project.status === 'active');
      if (activeProjects.length === 0) {
        return [];
      }
      const unread = snapshot.notifications.length;
      if (unread === 0) {
        return [];
      }
      const first = activeProjects[0];
      if (first === undefined) {
        return [];
      }
      return [
        {
          affectedEntity: { type: 'project', id: first.id, title: first.name },
          severity: 'low',
          title: `${activeProjects.length} active project(s) need attention`,
          description: `${activeProjects.length} active project(s) exist and ${unread} unread notification(s) may require a decision.`,
          facts: [`${activeProjects.length} active project(s); ${unread} unread notification(s).`],
          correlationSuffix: first.id,
        },
      ];
    },
  },
  {
    id: 'onboarding_delay',
    signalType: 'onboarding_delay',
    name: 'Onboarding delay',
    description:
      'A user signed up more than the deterministic window ago but has not reached their first succeeded workflow.',
    remediationCapabilities: ['workflow.start_onboarding', 'notifications.what_needs_attention'],
    evaluate: (snapshot) => {
      const now = Date.parse(snapshot.generatedAt);
      const detections: SignalDetection[] = [];
      for (const user of snapshot.onboarding) {
        if (user.firstWorkflowAt !== null) {
          continue;
        }
        const signedUpAt = Date.parse(user.signedUpAt);
        const elapsedMs = now - signedUpAt;
        if (Number.isNaN(signedUpAt) || elapsedMs < ONBOARDING_DELAY_DAYS * MS_PER_DAY) {
          continue;
        }
        const days = Math.floor(elapsedMs / MS_PER_DAY);
        detections.push({
          affectedEntity: {
            type: 'employee',
            id: user.userId,
            title: user.userId,
          },
          severity: 'medium',
          title: `Onboarding delayed for ${user.userId}`,
          description: `${user.userId} signed up ${days} day(s) ago and has not reached a first succeeded workflow.`,
          facts: [`${user.userId} signed up ${days} day(s) ago with no first workflow.`],
          correlationSuffix: user.userId,
        });
      }
      return detections;
    },
  },
  {
    id: 'audit_completeness',
    signalType: 'audit_completeness',
    name: 'Audit completeness gap',
    description:
      'The tenant has business executions whose audit-trail coverage is below the deterministic completeness target.',
    remediationCapabilities: ['notifications.what_needs_attention'],
    evaluate: (snapshot) => {
      const audit = snapshot.auditCompleteness;
      if (audit === undefined || audit.totalEvents === 0) {
        return [];
      }
      if (audit.traceableShare >= AUDIT_COMPLETENESS_MIN_SHARE) {
        return [];
      }
      return [
        {
          severity: 'medium',
          title: 'Audit trail is incomplete',
          description: `${audit.traceableShare}% of ${audit.totalEvents} business execution(s) have an audit-trail entry — below the ${AUDIT_COMPLETENESS_MIN_SHARE}% target.`,
          facts: [`${audit.traceableShare}% of ${audit.totalEvents} execution(s) traced.`],
          correlationSuffix: 'audit',
        },
      ];
    },
  },
];
