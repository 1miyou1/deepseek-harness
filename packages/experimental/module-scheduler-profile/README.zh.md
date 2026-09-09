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

将此 bundle 添加到源码 checkout 的 profile，以启用配置的 Luna、Terra 和 Sol 步骤路由、加载调度服务并注册 `network-research@1.0.0`。profile 必须提供兼容的 `@deepseek-ai/dsh-tools` peer；此 bundle 不会安装私有 ToolRuntime 副本。路由插件记录选择原因，`request/header` 记录实际使用的路由。模块开发助手虽已导出，但特意不进入默认 patch；如需启用，应用包含两个必要入口的 `cordis.developer.patch.yml`：

```yaml
- insert:
    - id: module-developer-tools
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/module-dev-tools'
    - id: module-developer
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/module-developer'
```

当前会话模型可以调用 `module-developer@1.0.0` 执行一次指定的比较替换、调用 `module-developer@2.0.0` 执行有界多步修改，或调用 `module-developer@3.0.0` 从仓库脚手架构建新模块。版本 3 必须显式选择 `luna` 或 `terra` 并拒绝 Sol；Host 先创建脚手架，再启动一个全新进程内子 Agent，只向它开放已有文件修改和验证工具，失败时通过生成器的受保护回滚删除脚手架。版本 2 和 3 每次请求最多输出 4096 个 token，模型步骤分别不超过 12 和 24。

将 `cordis.organizer.patch.yml` 作为独立可选层加入，可注册 `document-organizer@1.0.0`。每次调用都要提供明确的 Markdown 或 `.i18n.yaml` 路径列表和一个整理任务。模块先让 Luna 生成结构化计划；只有受管子 Agent 报告模型或传输错误时才用 Terra 重试一次，并且绝不选择 Sol。Host 在更新、新建或移动文件前验证所有声明路径；操作或针对性文档检查失败时恢复原文件。

<a id="model-experience"></a>
## 模型体验

### Profile composition

#### 模型会看到什么

此 profile 通过以下模型可见界面提供调度器及其选择性启用的模块工具。

##### Profile composition

```markdown
The default bundle changes profile composition and registers a host-side `ctx.web` workload without loading the development assistant. After explicit opt-in, the parent model reaches all developer versions through the scheduler's single `module_run` tool. Private development tools stay out of the parent catalog; managed versions project only their bounded edit and validation tools into fresh child scopes.
```

##### 模块校验器

```markdown
It copies the selected module into a temporary isolated directory, then executes fixed `test`, `lint`, and `typecheck` commands there in sequence through the sandbox and managed subprocess seam. The temporary copy is removed after the run. It does not write target files, call a model, or start an Agent. Its performance test covers only the local validation flow.
```

##### 文档整理器

```markdown
It accepts an explicit document path list and organization task, uses Luna to produce one structured plan, falls back once to Terra only after a managed model or transport error, and never uses Sol. Validated updates, creations, and content-preserving moves are applied together and rolled back when an operation or focused documentation check fails.
```

#### Token 影响

私有 Host 工具不会向普通模型工具目录增加 schema。受管整理和开发任务只向其全新子 Agent 添加有上限的任务、作用域工具和结构化输出 schema。

#### KV Cache 影响

私有工具不会改变稳定的模型请求前缀。

## 已知限制和后续工作

<a id="known-limitations-and-deferred-work"></a>

- **显式可选层**——官方 shipped profile 不加载此 bundle；bundle 的默认 patch 既不加载开发助手，也不加载文档整理器，需要使用各自的可选 patch。
- **不提供持久化**——此层不持久化进程或浏览器状态。
- **版本化执行方式**——版本 1 执行一次指定替换，版本 2 修改现有模块，版本 3 先创建一个固定脚手架再进行有界修改；它们都不使用 Agent Teams 或可续接子 Agent，受管步骤的 token 上限按单次请求计算而非累计。
- **尽力回滚**——整理器会在受控失败后恢复已捕获的文件内容，但进程突然终止仍可能打断恢复。运行时把模型和传输失败归为同一个受管子 Agent 错误类别，因此 Terra 降级无法进一步识别具体的 provider 中断。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护</summary>

此包为实验功能，遵循仓库的包和 profile 合同。
</details>
