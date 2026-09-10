---
description: "代码实现与修补器 Module Scheduler profile 的私有脚手架。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-code-implementer-profile

[English](README.md) | 中文

## 概述

专职代码实现与精准修补模块。
在授权的可写工作区路径范围内执行原子性源码变更与差异替换，防止未授权越权写入。

## 验证

运行 `node ./node_modules/vitest/vitest.mjs run packages/experimental/code-implementer-profile` 进行验证。

## 局限性

- 修改范围严格受限于授权的工作区可写路径。
