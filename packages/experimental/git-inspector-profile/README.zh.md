---
description: "Git状态分析器 Module Scheduler profile 的私有脚手架。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-git-inspector-profile

[English](README.md) | 中文

## 概述

这个私有脚手架拥有Git状态分析器模块的 profile 适配器。将此 bundle 加入运行 profile 前，必须替换显式的待实现失败、schema 和工具列表。

## 验证

模块实现后运行 `pnpm exec vitest run packages/experimental/git-inspector-profile/tests`。

## 模型体验

无，因为脚手架尚未接入 profile。

#### KV 缓存影响

在消费方显式加载已完成模块前无影响。

## 已知限制与延期工作

- **需要实现**——生成的执行器会显式失败；完成替换和测试前，bundle 必须保持未接入状态。

### 开发备注

无。
