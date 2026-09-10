---
description: "视频分析器 Module Scheduler profile 的私有脚手架。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-video-analyzer-profile

[English](README.md) | 中文

## 概述

专职视频分析与语音转写模块。
基于本地 SenseVoice ASR 与 PyAV 音频解包，实现零外部 API 成本、私有化的视频转写与分段提炼。

## 验证

运行 `node ./node_modules/vitest/vitest.mjs run packages/experimental/video-analyzer-profile` 进行验证。

## 模型体验

零外部 API 消耗；基于本地端到端语音模型转写。

#### KV 缓存影响

在接入运行中的 profile 前无影响。

## 已知限制与延期工作

- 真实执行依赖本地配置好的 Python 环境（PyAV + FunASR）。

### 开发备注

无。
