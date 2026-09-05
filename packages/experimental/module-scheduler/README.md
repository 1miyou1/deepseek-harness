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
- [Create a module scaffold](#create-a-module-scaffold)
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
- Module code receives only declared tools. Ordinary tools pass through DSH `ToolRuntime` validation, policy, approval, event, and cancellation processing.
- `registerHostTool()` adds a process-local tool visible only to module runs. Private Host tools do not enter the ordinary model tool catalog and take precedence over an ordinary tool with the same name. Browser controls may run a module only when every declared tool is present in this private registry; ordinary model tools remain unavailable there.
- Input is checked before admission. Output must satisfy the module schema before a result can be `succeeded` and `validated`.
- A module definition must use a positive integer `maxConcurrent`, a non-negative integer `queueLimit`, and a finite positive `timeoutMs`; invalid policies are rejected during registration.

-----

<a id="create-a-module-scaffold"></a>
## Create a module scaffold

Run `pnpm run create:module -- --id <kebab-id> --name "<Chinese name>" --description "<Chinese description>"`. The command creates one private experimental profile package, Chinese registration metadata, strict empty schemas, an explicit `module-implementation-required` executor, lifecycle coverage, bilingual README files, and its Host project reference. It never attaches the unfinished bundle to the main profile; implement the executor and schemas, run `pnpm install` plus package checks, then add the dependency and patch row explicitly.

To undo a generated scaffold, run `pnpm run create:module -- --remove --id <kebab-id>`. The command removes the package and its single Host reference only after confirming the generated package identity; it refuses missing, duplicated, or non-generated targets.

-----

<a id="verification"></a>
## Verification

From the repository root:

```sh
pnpm exec vitest run packages/experimental/module-scheduler/tests scripts/create-module.spec.ts
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
