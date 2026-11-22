# ADR-0014: Unresolved acknowledgment timeouts and escalation

- **Status**: Accepted (open decision 10)
- **Date**: 2026-11-22

## Decision (tenant-configurable, defaults shown)

| Setting                   | Default     | Range  | Effect                                                 |
| ------------------------- | ----------- | ------ | ------------------------------------------------------ |
| `sentOutReminderMinutes`  | 5           | 1–30   | push reminder to guardian "Please confirm pickup"      |
| `sentOutExceptionMinutes` | 15          | 5–60   | `sent_out → exception`; dashboard alert to dispatchers |
| `requestedStaleMinutes`   | 30          | 10–120 | `stale` flag on `requested` (highlighted in queue)     |
| `endOfDayTime`            | 18:00 local | —      | open requests → `exception`; queue day rollover        |
| `dailyDigestEnabled`      | false       | —      | school admins receive unresolved summary next morning  |

Exceptions are closed by guardian late confirmation (`acknowledged`) or by staff `resolve` with a
resolution (`guardian_confirmed_offline`, `staff_confirmed_handoff`, `student_not_collected`,
`request_in_error`, `other`) and a note.

## Consequences

Worker jobs `PickupTimeouts` and `EndOfDaySweep`; unresolved report reads `exception` + `resolved`.
