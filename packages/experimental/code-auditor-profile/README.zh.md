---
description: "代码与变更审计器 Module Scheduler profile 的私有脚手架。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-code-auditor-profile

[English](README.md) | 中文

## 概述

专职代码与变更审计模块。
支持静态安全红线拦截、凭据与越权修改扫描、过度设计 (Ponytail) 审查以及轻量经济模型语义审计。

## 验证

运行 `node ./node_modules/vitest/vitest.mjs run packages/experimental/code-auditor-profile` 进行验证。

## 模型体验

本地静态规则零模型消耗；语义深度审查可派发至经济型低成本模型。

#### KV 缓存影响

在接入运行中的 profile 前无影响。

## 已知限制与延期工作

- 目前提供全量静态规则审查与 Git 差异检测。

### 开发备注

无。
