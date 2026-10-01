# @nexora/module-remediation

Bounded context: **governed remediation** — a plan derived from a detected
problem, steps that need approval, execution through the AI runtime, and
re-verification.

Lineage (Prompt 6). With an optional `LineageRepository` the service records,
at plan creation and every replan (run id = the plan id):

- one `EVIDENCE` record per problem evidence item used (real source ids;
  knowledge → `KNOWLEDGE_ARTICLE`/`DOCUMENT`, entities → `PROJECT`/`EMPLOYEE`/
  `BUDGET`, detection facts → `INVESTIGATION` marked derived);
- one **derived** `FINDING` (`REMEDIATION_BASIS`) that references those
  evidence records (`evidenceRecordIds`) and their combined fingerprint;
- `LINK` records `STEP_APPROVAL` (step ↔ approval) and `STEP_RUN` (step ↔ the
  orchestrator run that executed it), so the Audit Center trace of a
  remediation approval shows finding → approval → executions → verification.

Records are append-only: a replan appends a new basis and never rewrites the
old one. The execution journal also records the approval and delegation ids.
Remediation is human-driven (no agent principal), so `agentIdentityId` stays
empty. See `platform/ai-runtime/docs/TRUST_MODEL.md` §10.
