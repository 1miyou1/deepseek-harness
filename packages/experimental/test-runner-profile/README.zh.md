---
description: "测试执行与降噪诊断器 Module Scheduler profile 的私有脚手架。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-test-runner-profile

[English](README.md) | 中文

## 概述

专职受管测试执行与终端降噪诊断模块。
通过受管子进程安全运行单测套件，自动剥离 ANSI 颜色与控制台噪音，向主模型输出高度提炼的结构化失败诊断与关键报错靶点。

## 验证

运行 `node ./node_modules/vitest/vitest.mjs run packages/experimental/test-runner-profile` 进行验证。

## 局限性

- 测试命令受限于授权的包路径与测试范围。
