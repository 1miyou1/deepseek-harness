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

Loading the default export registers one registry, one in-process coordinator, and the model-visible `module_run` tool. Direct Host callers pass `sessionId`, `taskId`, and a versioned `moduleRef` to `ctx.moduleScheduler.run(request)`. Model calls pass only `moduleRef` and `input`; the tool derives the trusted session and task identities from its initiating Agent and call. The returned promise also exposes its `runId` and a run-scoped `cancel()` operation. Disposing the plugin fiber cancels queued and active runs, releases the coordinator, and rejects later calls as `blocked` with reason `disposed`; the service is then removed.

-----

<a id="execution-rules"></a>
## Execution rules

- Every invocation receives a fresh run identity, abort signal, and result.
- Global and per-module concurrency and queue limits are enforced independently; excess work is returned as `blocked`.
- Module code receives only declared tools. A model-originated run resolves and executes ordinary tools in the initiating Agent's scope, preserving its restrictions, approval routing, events, and cancellation processing.
- `registerHostTool()` adds a process-local tool visible only to module runs. A registration may also provide a trusted factory that projects that exact capability into one managed child's own tool scope; the scoped proxy disappears when the child is disposed and never enters the parent or global model catalog. Private Host tools take precedence over ordinary tools with the same name.
- Agent-originated modules may use the narrow `context.agent.run()` capability. It always starts one fresh in-process child through `ctx.subagents` and normally inherits the initiating Agent's resolved model route. When `agentStepModelRoutes` is configured, automatic routing applies only inside that managed child; a module may instead request the exact `luna` or `terra` route for one run, but the interface does not accept `sol`. It enforces caller-declared step and per-request output-token limits, requires structured completion, and awaits disposal before returning. Modules marked `requiresAgent` are rejected by browser controls.
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

Indirectly, through the profile-mounted Tool Runtime adapter, which exposes one `module_run` tool for selecting a registered versioned module, supplying schema-checked input, and receiving the scheduler's structured terminal result while a managed module receives only a narrow one-shot Agent runner rather than an LLM client, provider selector, child handle, or tool registry.

#### KV Cache effect

The stable model request prefix includes the fixed `module_run` schema. Registered module definitions remain outside that schema, so catalog growth does not expand the prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Private opt-in only** — no shipped profile loads this package.
- **Process-local scheduling only** — queued and active runs are not persisted or restored after restart.
- **Per-request token ceiling only** — managed children bound model steps and each request's maximum output tokens; the scheduler does not claim a hard cumulative token budget.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
