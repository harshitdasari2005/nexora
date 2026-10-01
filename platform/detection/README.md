# @nexora/module-detection

Bounded context: **detection and investigation** — deterministic signals over
tenant/workspace snapshots, problems, investigation evidence and known
solutions.

Evidence and lineage (Prompt 6): a problem's investigation evidence is
**recomputed on read** (ids regenerate, values follow current state), so it is
_not_ the historical evidence of a decision. When a remediation plan is
created, `platform/remediation` records the evidence it rests on (primary
evidence with real source ids) and a **derived** finding in the append-only
lineage — that recorded basis, not a re-run of detection, is what the Audit
Center shows. Investigation evidence of kind `INVESTIGATION` is derived, never
primary source evidence. Known gap: the facts that made a _signal_ fire are not
persisted. See `platform/ai-runtime/docs/TRUST_MODEL.md` §10.
