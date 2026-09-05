# Agent Note: Agent-step model routing

Status: implemented

[English](2026-09-05-agent-step-model-routing.md) | 中文

## Problem

Agent 模型选择已经把同一条路由快照用于提示词组装和 `agent/request`，子 Agent 也继承最新记录的请求路由。任务路由需要在该快照前读取已领取的用户输入；`agent/pre-step` 发生在提示词组装后，因此时机过晚。

## 决策

Agent loop 在 inbox 领取之后、提示词组装之前提供 `agent/route-step` waterfall。实验插件只分类新的用户文本，更新 Agent 作用域已安装的 `ModelSelectionRef`，并追加 `model/routing-decision`；`request/header` 继续记录实际执行的路由。显式 `model/selection` 意图优先，工具结果续步保持当前路由。

首版策略把轻量工作映射到 Luna，把架构、复杂调试和高风险工作映射到 Sol，其他工作映射到 Terra。部署配置确切的 provider/model 路由；价格和上下文窗口元数据不参与决策。

## Alternatives considered

没有把路由放入 preset，因为 preset 拥有会话组成，而不是逐步骤任务决策。没有放入模块或 GUI，因为模块必须继承 Agent 已解析路由，客户端只能消费运行时决策而不能重新推导。没有使用 `agent/pre-step`，因为此时提示词组装已经捕获请求路由。

## 结果

提示词变量、模型请求和 `request/header` 使用同一个步骤快照。模块和受管子 Agent 不需要模型选择逻辑。确定性分类器仍是实验功能；失败升级和独立审查路由属于后续不同策略。

## 验证

核心拦截测试固定 `route-step` 先于提示词组装和 pre-step 准入。实验包测试固定三档路由、显式选择优先、工具续步、持久原因事件和实际请求头。既有子 Agent 选项测试固定从最新请求头继承路由。
