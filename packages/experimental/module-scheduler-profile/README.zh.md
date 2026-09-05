---
description: "实验模块调度服务的私有 Host profile 层。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-module-scheduler-profile

[English](README.md) | 中文

## 概述

Luna、Terra 和 Sol 确定性 Agent 路由、实验模块调度服务、`network-research` 工作负载和受限模块开发助手的私有 Host profile 层。此包只供选择性启用，官方 shipped profile 不包含它。

## 目录

- [用法](#usage)
- [模型体验](#model-experience)
- [已知限制和后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="usage"></a>
## 用法

将此 bundle 添加到源码 checkout 的 profile，以启用配置的 Luna、Terra 和 Sol 步骤路由、加载调度服务并注册 `network-research@1.0.0`。路由插件记录选择原因，`request/header` 记录实际使用的路由。模块开发助手虽已导出，但特意不进入默认 patch；如需启用，请在更晚应用的 profile patch 中同时加入两个入口：

```yaml
- insert:
    - id: module-developer-tools
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/module-dev-tools'
    - id: module-developer
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/module-developer'
```

当前会话模型可以调用 `module-developer@1.0.0` 执行一次指定的比较替换，也可以调用 `module-developer@2.0.0` 执行有界多步任务。版本 2 会启动一个继承发起模型路由的全新进程内子 Agent；该子 Agent 只能看到五个子级作用域开发工具和 `structured_output`，最多执行 12 个模型步骤，且每次请求最多输出 4096 个 token。两个版本共用相同的模块 ID、路径、符号链接、敏感文件、已有文件、写前比较、沙箱、子进程、受限输出和取消约束。

<a id="model-experience"></a>
## 模型体验

### Profile composition

#### 模型会看到什么

默认 bundle 会改变 profile composition 并注册 Host 侧 `ctx.web` 工作负载，但不会加载开发助手。显式启用后，父模型通过调度器唯一的 `module_run` 工具到达两个开发助手版本。私有开发工具不会进入父模型目录；版本 2 只把这些工具投影到其受管子 Agent 的作用域。

#### Token 影响

私有 Host 工具不会向普通模型工具目录增加 schema；开发助手也不增加提示词文本。

#### KV Cache 影响

私有工具不会改变稳定的模型请求前缀。

## 已知限制和后续工作

<a id="known-limitations-and-deferred-work"></a>

- **需要两次显式启用**——官方 shipped profile 不加载此 bundle，bundle 的默认 patch 也不加载开发助手。
- **不提供持久化**——此层不持久化进程或浏览器状态。
- **版本化执行方式**——`module-developer@1.0.0` 执行一次指定的单文件替换；`module-developer@2.0.0` 把有界多步任务委派给一个全新子 Agent，但不会创建文件、使用 Agent Teams、使用可续接子 Agent，也不声称提供累计 token 预算。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护</summary>

此包为实验功能，遵循仓库的包和 profile 合同。
</details>
