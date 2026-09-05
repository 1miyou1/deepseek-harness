---
description: "私有实验性 Cordis 服务，通过 DSH 工具管线执行隔离且有界的模块运行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-module-scheduler

[English](README.md) | 中文

## 概述

这个私有孵化包注册 `ctx.moduleScheduler`。它共享不可变模块定义，同时保持每次运行的身份、取消信号、结果和有界准入状态相互独立。

## 目录

- [服务合同](#service-contract)
- [执行规则](#execution-rules)
- [创建模块脚手架](#create-a-module-scaffold)
- [验证](#verification)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="service-contract"></a>
## 服务合同

加载默认导出会注册一个注册表和一个进程内协调器。调用 `ctx.moduleScheduler.run(request)` 时传入 `sessionId`、`taskId` 和带版本的 `moduleRef`。返回的 Promise 还公开其 `runId` 和运行级 `cancel()` 操作。释放插件 fiber 会取消排队和运行中的任务、释放协调器；之后的调用会以 `blocked` 和 `disposed` 原因拒绝，服务随后被移除。

-----

<a id="execution-rules"></a>
## 执行规则

- 每次调用获得新的运行身份、中止信号和结果。
- 全局并发、模块级并发和两级队列上限分别执行；超额工作返回 `blocked`。
- 模块代码只能获得声明的工具。普通工具调用经过 DSH `ToolRuntime` 的校验、策略、审批、事件和取消处理。
- `registerHostTool()` 添加只对模块运行可见的进程内工具。私有 Host 工具不会进入普通模型工具目录，并优先于同名普通工具。浏览器控制面板只有在模块声明的每个工具都存在于该私有注册表中时才能运行模块；普通模型工具仍不可从这里调用。
- 输入在准入前校验。输出必须满足模块 schema，结果才能成为 `succeeded` 且 `validated`。
- 模块定义必须使用正整数 `maxConcurrent`、非负整数 `queueLimit` 和有限正数 `timeoutMs`；非法策略会在注册时拒绝。

-----

<a id="create-a-module-scaffold"></a>
## 创建模块脚手架

运行 `pnpm run create:module -- --id <kebab-id> --name "<中文名称>" --description "<中文描述>"`。该命令创建一个私有实验性 profile 包、中文注册元数据、严格空 schema、显式 `module-implementation-required` 执行器、生命周期测试、双语 README 和 Host 工程引用。它不会把未完成 bundle 接入主 profile；请先实现执行器和 schema，运行 `pnpm install` 与包级检查，再显式添加依赖和 patch 行。

撤销生成的脚手架时运行 `pnpm run create:module -- --remove --id <kebab-id>`。命令只会在确认生成包身份后删除包目录及唯一的 Host 引用；目标不存在、引用重复或目标不是生成脚手架时会拒绝操作。

-----

<a id="verification"></a>
## 验证

在仓库根目录运行：

```sh
pnpm exec vitest run packages/experimental/module-scheduler/tests scripts/create-module.spec.ts
pnpm exec tsc -b packages/experimental/module-scheduler/tsconfig.json --force
pnpm exec tsx scripts/run-oxlint.ts packages/experimental/module-scheduler
```

-----

<a id="model-experience"></a>
## 模型体验

间接产生影响，具体由选择模块并呈现结构化结果的消费方决定。

#### KV 缓存影响

该服务不添加提示词或工具 schema，因此不会改变稳定的模型请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限私有显式启用**——发布 profile 不加载本包。
- **仅支持进程内调度**——排队和活跃运行不会持久化，也不会在重启后恢复。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
