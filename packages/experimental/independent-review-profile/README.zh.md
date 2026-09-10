---
description: "独立代码与架构审查器 Module Scheduler profile 的私有脚手架。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-independent-review-profile

[English](README.md) | 中文

## 概述

专职独立代码与架构审查模块。
审查工作区代码变更的架构合规性、伴随测试完备度以及破坏性依赖风险。

## 验证

运行 `node ./node_modules/vitest/vitest.mjs run packages/experimental/independent-review-profile` 进行验证。

## 局限性

- 仅对当前本地 Git 仓库状态进行纯只读分析。
