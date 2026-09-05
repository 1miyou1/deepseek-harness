---
description: "在提示词组装前为新的 Agent 任务确定性选择 Luna、Terra 和 Sol 路由。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-agent-step-model-router

[English](README.md) | 中文

## 概述

使用此包可让轻量工作使用 Luna、复杂或高风险工作使用 Sol，其他新用户任务使用 Terra。路由在提示词组装前生效，因此提示词变量与 provider 请求保持一致。显式模型选择优先，工具结果续步保留当前路由。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 Agent 和 Session projection 服务之后挂载插件，并为每个档位配置一条确切路由。

### 何时选择

当源码 checkout 的 profile 需要按任务自动选择模型时使用此包。当每个 Agent 必须固定使用一个模型，或产品需要学习型分类器时不要使用。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-experimental-agent-step-model-router'
  config:
    luna: { provider: openai-codex, model: gpt-5.6-luna }
    terra: { provider: openai-codex, model: gpt-5.6-terra }
    sol: { provider: openai-codex, model: gpt-5.6-sol }
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `luna` | 必填 | 轻量任务的确切 provider 和 model |
| `terra` | 必填 | 默认任务的确切 provider 和 model |
| `sol` | 必填 | 复杂和高风险任务的确切 provider 和 model |

生成的[配置目录](../../../docs/config-catalog.zh.md)是所有可接受字段的完整真源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部结构——点击展开</summary>

`agent/route-step` 在 inbox 领取之后、提示词组装之前运行。插件只分类新的用户文本，更新 Agent 作用域模型选择引用，并记录 `model/routing-decision`；`request/header` 记录发送给 provider 的路由。工具结果续步没有新的用户任务，因此保留当前路由。

| 源码 | 职责 |
|---|---|
| [`src/router.ts`](src/router.ts) | 确定性分类 |
| [`src/index.ts`](src/index.ts) | Agent 事件接线与优先级规则 |
| [`src/projection.ts`](src/projection.ts) | 持久决策事件与 projection |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Agent 步骤路由决策](../../../.agents/notes/implemented/architecture/2026-09-05-agent-step-model-routing.zh.md)——owner 和未采用的位置。
- [架构](../../../docs/architecture.zh.md#turn-flow)——Agent 轮次顺序和扩展点。
- [模块调度 Profile](../module-scheduler-profile/README.zh.md)——选择性启用的 profile 组合。

-----

<a id="model-experience"></a>
## 模型体验

### 步骤路由

#### 模型会看到什么

插件不增加提示词文本或工具。`agent/route-step` 在提示词组装前选择路由。轻量分类、抽取、摘要、格式化和批处理任务使用 Luna。架构、大型代码库、并发、根因、安全、授权、隐私、支付、生产、迁移和破坏性任务使用 Sol。其他任务使用 Terra，显式模型选择会绕过自动路由。

#### Token 影响

插件不增加模型可见 token。

#### KV Cache 影响

路由变化可能开启不同的 provider/model 缓存序列。工具结果续步保持已选择的路由。

## 已知限制和后续工作

<a id="known-limitations-and-deferred-work"></a>

此包有意只提供范围较窄的首版策略。

- 分类使用新的用户文本进行确定性关键词匹配，不调用模型。
- 尚未实现自动失败升级和独立审查模型路由。
- 官方发布的 profile 不包含此实验包。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
