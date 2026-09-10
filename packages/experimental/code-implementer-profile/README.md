---
description: "Private scaffold for the 代码实现与修补器 Module Scheduler profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-code-implementer-profile

English | [中文](README.zh.md)

## Summary

Dedicated code implementation and patching module for DSH.
Executes atomic, verified source file modifications within authorized write boundaries.

## Verification

Run `node ./node_modules/vitest/vitest.mjs run packages/experimental/code-implementer-profile` to verify.

## Limitations

- Modifications are strictly limited to authorized workspace paths.
