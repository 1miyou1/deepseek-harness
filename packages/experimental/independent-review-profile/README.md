---
description: "Private scaffold for the 独立代码与架构审查器 Module Scheduler profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-independent-review-profile

English | [中文](README.zh.md)

## Summary

Dedicated independent code and architecture reviewer module for DSH.
Audits architectural compliance, companion test coverage, and breaking dependency changes.

## Verification

Run `node ./node_modules/vitest/vitest.mjs run packages/experimental/independent-review-profile` to verify.

## Limitations

- Read-only analysis on current git repository status.
