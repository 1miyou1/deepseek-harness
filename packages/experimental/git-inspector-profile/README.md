---
description: "Private scaffold for the Git状态分析器 Module Scheduler profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-git-inspector-profile

English | [中文](README.zh.md)

## Summary

This private scaffold owns the Git状态分析器 module profile adapter. Replace the explicit implementation-required failure, schemas, and tool list before adding this bundle to a running profile.

## Verification

Run `pnpm exec vitest run packages/experimental/git-inspector-profile/tests` after implementing the module.

## Model Experience

None, as the scaffold is not attached to a profile.

#### KV Cache effect

None until a consumer explicitly loads the completed module.

## Known Limitations and Deferred Work

- **Implementation required** — the generated executor fails explicitly and the bundle must remain detached until replaced and tested.

### Dev Note

None.
