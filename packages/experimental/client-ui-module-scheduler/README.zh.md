---
description: "注册模块与符合条件运行的私有 Web 控制台。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-module-scheduler

[English](README.md) | 中文

## 概述

此私有 Web 包提供会话头部控制台，用于查看已注册模块并启动符合浏览器条件的运行。

## 目录

- [用法](#usage)
- [模型体验](#model-experience)
- [已知限制和后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="usage"></a>
## 用法

控制台列出已注册模块，校验 JSON 输入，启动符合条件的运行，刷新状态，呈现结构化结果并取消活动运行。

<a id="model-experience"></a>
## 模型体验

### 控制台界面

#### 模型会看到什么

控制台只运行在浏览器中，不增加模型上下文；操作由 `src/client/mount.ts` 挂载。

#### Token 影响

此包不增加提示词文本或模型工具 schema。

#### KV Cache 影响

此包不改变模型请求前缀。

## 已知限制和后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅供私有选择性启用**——官方 shipped profile 不加载此包。
- **不提供持久化**——浏览器状态只存在于进程内，重启后不会恢复。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护</summary>

此包为实验功能，遵循仓库的包和 profile 合同。
</details>
