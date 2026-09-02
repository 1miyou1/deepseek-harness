---
description: "Private experimental Cordis service for isolated, bounded module runs through the DSH tool pipeline."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-module-scheduler

English | [中文](README.zh.md)

## Summary

This private incubation package registers `ctx.moduleScheduler`. It shares immutable module definitions while keeping each run identity, cancellation signal, result, and bounded admission state independent.

## Table of Contents

- [Service contract](#service-contract)
- [Execution rules](#execution-rules)
- [Verification](#verification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="service-contract"></a>
## Service contract

Loading the default export registers one registry and one in-process coordinator. Call `ctx.moduleScheduler.run(request)` with `sessionId`, `taskId`, and a versioned `moduleRef`. The returned promise also exposes its `runId` and a run-scoped `cancel()` operation. Disposing the plugin fiber cancels queued and active runs, releases the coordinator, and rejects later calls as `blocked` with reason `disposed`; the service is then removed.

-----

<a id="execution-rules"></a>
## Execution rules

- Every invocation receives a fresh run identity, abort signal, and result.
- Global and per-module concurrency and queue limits are enforced independently; excess work is returned as `blocked`.
- Module code receives only declared tools. Calls pass through DSH `ToolRuntime` validation, policy, approval, event, and cancellation processing.
- Input is checked before admission. Output must satisfy the module schema before a result can be `succeeded` and `validated`.
- A module definition must use a positive integer `maxConcurrent`, a non-negative integer `queueLimit`, and a finite positive `timeoutMs`; invalid policies are rejected during registration.

-----

<a id="verification"></a>
## Verification

From the repository root:

```sh
pnpm exec vitest run packages/experimental/module-scheduler/tests
pnpm exec tsc -b packages/experimental/module-scheduler/tsconfig.json --force
pnpm exec tsx scripts/run-oxlint.ts packages/experimental/module-scheduler
```

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through consumers that select a module and render its structured result.

#### KV Cache effect

The service adds no prompt or tool schema, so it does not change the stable model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Private opt-in only** — no shipped profile loads this package.
- **Process-local scheduling only** — queued and active runs are not persisted or restored after restart.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
