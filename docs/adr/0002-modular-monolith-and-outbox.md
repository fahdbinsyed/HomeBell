# ADR-0002: Modular monolith, transactional outbox, RabbitMQ deferred

- **Status**: Accepted
- **Date**: 2026-11-22

## Context

We need reliable asynchronous processing (push, SMS, timeouts, realtime fan-out) without the operational
cost of microservices or a message broker in the initial stack.

## Decision

- One API host and one worker host composed of modules with enforced boundaries
  (see `docs/architecture/01-backend-modules.md`). Architecture tests fail the build on violations.
- Events are written to a per-module **outbox table in the same transaction** as the state change and
  dispatched by the worker (at-least-once, idempotent consumers, `FOR UPDATE SKIP LOCKED`, `pg_notify`).
- RabbitMQ is **not** part of the initial stack. Introduce it (behind `IEventBus`) only when measured
  outbox throughput, fan-out to external consumers, or worker isolation require it — with a new ADR.

## Consequences

- Simple local dev (Postgres + Redis only), transactional consistency for events.
  − Outbox polling adds ~50–200 ms latency to async effects; the API may publish realtime events
  directly after commit for latency, with the outbox as the guaranteed path.
