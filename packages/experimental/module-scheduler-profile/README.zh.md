---
description: "实验模块调度服务的私有 Host profile 层。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-module-scheduler-profile

[English](README.md) | 中文

## 概述

实验模块调度服务及其真实 `network-research` 模块的私有 Host profile 层。此包只供选择性启用，官方 shipped profile 不包含它。

## 目录

- [用法](#usage)
- [模型体验](#model-experience)
- [已知限制和后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="usage"></a>
## 用法

将此 bundle 添加到源码 checkout 的 profile，以加载调度服务并注册 `network-research@1.0.0`。该模块接受一个 `query`，通过 profile 已配置的 `ctx.web` provider 搜索，最多返回八个来源，并输出结构化摘要和来源。

<a id="model-experience"></a>
## 模型体验

### Profile composition

#### 模型会看到什么

此 bundle 改变 profile composition 并注册 Host 侧 `ctx.web` 工作负载；它不增加模型提示词或模型可见工具。

#### Token 影响

此 bundle 自身不增加提示词文本或模型工具 schema。

#### KV Cache 影响

此 bundle 自身不改变模型请求前缀。

## 已知限制和后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅供私有选择性启用**——官方 shipped profile 不加载此 bundle。
- **不提供持久化**——此层不持久化进程或浏览器状态。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护</summary>

此包为实验功能，遵循仓库的包和 profile 合同。
</details>
