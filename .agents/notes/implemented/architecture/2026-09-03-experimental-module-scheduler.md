# Agent Note: Incubate module scheduling as a private experimental service

Status: implemented

English | [中文](2026-09-03-experimental-module-scheduler.zh.md)

## Problem

Multiple host sessions need to invoke immutable module definitions with independent run identity, bounded per-module concurrency, a finite queue, and run-scoped cancellation. The existing workflow and Agent Teams packages own different lifecycle semantics, while adapters must not redefine scheduling state or result validation.

## Decision

The private `@deepseek-ai/dsh-experimental-module-scheduler` package owns module definitions, run state, independent global and per-module queue admission, cancellation, result validation, and the Cordis service. Its Tool Runtime adapter maps ordinary host tool calls into the runner, while a separate private Host registry contributes module-only tools without publishing model tool schemas. The opt-in profile uses that registry for a single-file development assistant: every development tool verifies the exact assistant module identity, writes compare against the content read in the same run, and fixed validation commands execute through the managed subprocess service under a target-rooted read-only sandbox. Disposing the Cordis service cancels queued and active runs and rejects later submissions as `blocked` with reason `disposed`. The package participates in the Host TypeScript and library build graph, but remains under `packages/experimental` and outside supported profile bundles and release packages.

Built-artifact coverage imports `lib/index.js` in plain Node after the Host library build. Source tests cover scheduling and Tool Runtime behavior without requiring built output.

## Alternatives considered

Adding the semantics to workflow, Agent Teams, or a UI adapter would give another subsystem ownership of module-run state and make cross-entry behavior drift. Shipping the package in a default profile would turn an incubating contract into a supported product surface before its runtime integration is complete.

## Consequences

DSH can compile, bundle, and test the scheduler using its normal Host gates while preserving the experimental publication boundary. Promotion later requires an explicit package and profile decision; no compatibility alias is retained for the experimental package name.
