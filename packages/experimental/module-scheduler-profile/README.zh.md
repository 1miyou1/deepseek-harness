---
description: "实验模块调度服务的私有 Host profile 层。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-module-scheduler-profile

[English](README.md) | 中文

## 概述

实验模块调度服务、`network-research` 工作负载和受限模块开发助手的私有 Host profile 层。此包只供选择性启用，官方 shipped profile 不包含它。

## 目录

- [用法](#usage)
- [模型体验](#model-experience)
- [已知限制和后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="usage"></a>
## 用法

将此 bundle 添加到源码 checkout 的 profile，以加载调度服务并注册 `network-research@1.0.0`。模块开发助手虽已导出，但特意不进入默认 patch；如需启用，请在更晚应用的 profile patch 中同时加入两个入口：

```yaml
- insert:
    - id: module-developer-tools
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/module-dev-tools'
    - id: module-developer
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/module-developer'
```

开发助手会读取并比较替换 `packages/experimental/<id>-profile` 内的一个现有文件，再运行固定的 `test`、`lint` 和无输出 `typecheck` 动作。Host 会拒绝非法模块 ID、父级或绝对路径、符号链接逃逸、敏感文件名、不存在的文件，以及读取后发生内容漂移的文件。验证通过受管子进程服务运行，使用清除凭据的环境、受限输出、运行级取消，以及根目录限定为目标 profile 的 Host 只读沙箱。

<a id="model-experience"></a>
## 模型体验

### Profile composition

#### 模型会看到什么

默认 bundle 会改变 profile composition 并注册 Host 侧 `ctx.web` 工作负载，但不会加载开发助手。显式启用后，只有 `module-developer@1.0.0` 能调用它的五个私有工具；这些工具不会进入普通模型工具目录，此 bundle 也不增加模型提示词。

#### Token 影响

私有 Host 工具不会向普通模型工具目录增加 schema；开发助手也不增加提示词文本。

#### KV Cache 影响

私有工具不会改变稳定的模型请求前缀。

## 已知限制和后续工作

<a id="known-limitations-and-deferred-work"></a>

- **需要两次显式启用**——官方 shipped profile 不加载此 bundle，bundle 的默认 patch 也不加载开发助手。
- **不提供持久化**——此层不持久化进程或浏览器状态。
- **单文件替换**——首版助手只比较替换一个现有模块文件并运行固定验证；它不会创建文件、输出类型检查构建产物、创建完整模块或自主迭代。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护</summary>

此包为实验功能，遵循仓库的包和 profile 合同。
</details>
