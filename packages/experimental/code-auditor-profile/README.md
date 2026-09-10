---
description: "Private scaffold for the 代码与变更审计器 Module Scheduler profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-code-auditor-profile

English | [中文](README.zh.md)

## Summary

Dedicated code and diff auditor module for DSH.
Enforces static safety boundaries, security checks, Ponytail rules, and economy-model review.

## Verification

Run `node ./node_modules/vitest/vitest.mjs run packages/experimental/code-auditor-profile` to verify.

## Model Experience

Zero model consumption for local static rules; delegates semantic review to economy models.

#### KV Cache effect

None until loaded into a profile.

## Known Limitations and Deferred Work

- Currently provides full static rule auditing and diff inspection.

### Dev Note

None.
