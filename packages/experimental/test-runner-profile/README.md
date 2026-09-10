---
description: "Private scaffold for the 测试执行与降噪诊断器 Module Scheduler profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-test-runner-profile

English | [中文](README.zh.md)

## Summary

Dedicated test execution and diagnostic noise-reduction module for DSH.
Executes test runners via managed subprocess, strips console noise, and outputs structured failure diagnostics.

## Verification

Run `node ./node_modules/vitest/vitest.mjs run packages/experimental/test-runner-profile` to verify.

## Limitations

- Test commands are restricted to authorized package test scopes.
