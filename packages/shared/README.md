# @nexora/shared

The Nexora **shared platform foundation** — the reusable building blocks every domain and platform module builds on (ENGINEERING_PLAYBOOK.md §4, BKD.md §6).

## Modules

| Path          | Contents                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------- |
| `logger/`     | Structured JSON logger with tenant/workspace/correlation context (BKD.md §15, SAD.md §16) |
| `errors/`     | Base error hierarchy mapped to the API error taxonomy (API_CONTRACTS.md §10)              |
| `result/`     | `Result<T, E>` pattern — no thrown control flow inside domain logic (BKD.md §4, §14)      |
| `ids/`        | UUID / entity-id / correlation-id utilities (`node:crypto`)                               |
| `time/`       | ISO-8601 UTC time helpers                                                                 |
| `validation/` | Dependency-free validation helpers returning typed issues                                 |
| `constants/`  | Log levels, error codes, side-effect classes                                              |
| `utils/`      | Generic helpers (`deepFreeze`, `assertNever`, `safeJsonParse`)                            |
| `events/`     | Event envelope base types (PSD.md §4 EVT-*, SAD.md §11)                                   |

## Usage

```ts
import { createLogger } from '@nexora/shared/logger';
import { Result, ok, err } from '@nexora/shared/result';
import { newEntityId } from '@nexora/shared/ids';

const log = createLogger({ service: 'projects' }).with({ tenantId });
const outcome: Result<Project, Error> = ok(project);
```

## Quality

- TypeScript strict mode; zero `any`; every export documented.
- Unit tests for `logger`, `result`, `ids`, `validation` (`pnpm test`).
- Pure foundation — no business logic, no I/O beyond the injectable log writer.
