# Nexora Security

S21 (ROADMAP.md §21) hardening ledger. Success criterion: **zero open
critical/high findings**. The adversarial test suite lives in
`apps/api/test/security-isolation.test.ts` (tenant/workspace sweep) and the
per-module suites referenced below.

## Red-team findings (closed in S21)

| ID    | Severity | Finding                                                                                                                                                                                                     | Fix                                                                                                                                                                                       | Regression tests                                                                                                                                                     |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IN-01 | High     | The signed inbound email endpoint documented "dedupe by message id" but never persisted the claim — a captured signed request was replayable forever (audit-event spam; unguarded for future action types). | Exactly-once claim ledger: `inbound_messages` table with unique `(tenant_id, message_id)`, claimed atomically (`onConflictDoNothing`) BEFORE the action routes; replays return 409.       | `webhook-application.test.ts` (replay + no-claim-for-denied-sender), `integrations.test.ts` (409 replay), `repositories.integration.test.ts` (claim once per tenant) |
| IN-02 | Medium   | Both the inbound verification and outbound signing used plain `sha256(secret:body)` concatenation instead of a keyed MAC (length-extension-prone construction).                                             | Standard HMAC-SHA256 (`createHmac`) in `IntegrationApplicationService.sign`, the inbound route's `verifySignature`/`signInboundBody`. Signature scheme header unchanged (`sha256=<hex>`). | existing signature verification tests (recompute with the same function)                                                                                             |
| IN-03 | Medium   | Webhook delivery-receipt reads were tenant-scoped but NOT workspace-scoped: a member of workspace A could read workspace B's receipts by passing B's endpoint id.                                           | `listWebhookDeliveries` now resolves the endpoint and returns NOT FOUND unless it belongs to the authorized workspace.                                                                    | `webhook-application.test.ts` (IN-03), `security-isolation.test.ts` (API-level 404)                                                                                  |
| IN-04 | Medium   | `INTEGRATIONS_INBOUND_SECRET` had a hardcoded default (`nexora-inbound-dev-secret`) — a deployment omitting the var silently signed inbound actions with a publicly-known secret.                           | The var is now REQUIRED (fail-fast at startup); documented in `.env.example`; test harnesses set their own value.                                                                         | all API suites (fail-fast config)                                                                                                                                    |

## Scans

- **Secrets gate:** `pnpm scan:secrets` (also for CI) scans every git-tracked
  file for high-signal credential patterns (AWS/GCP keys, private keys,
  GitHub/Slack/OpenAI tokens, JWTs, hardcoded config secrets). Blocking on
  any finding (ENGINEERING_PLAYBOOK.md §10.1).
- **Dependency vulnerabilities:** reviewed at each phase gate (PLAYBOOK §10);
  `pnpm audit` before pilot.

## Penetration test schedule

- **S23 entry (pilot onboarding):** external pen-test against the pilot
  staging environment (authenticated + unauthenticated scopes) covering
  tenant isolation, the signed inbound endpoint, AI tool boundary, and
  workflow approval paths. Findings enter this ledger with the same
  zero-critical/high close criterion.
- **Pre-production (M8 gate):** follow-up pen-test + SOC 2 readiness review
  (ROADMAP.md M8, SAD §13.8).
