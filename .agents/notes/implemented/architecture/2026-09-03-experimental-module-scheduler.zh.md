# Agent Note: 将模块调度孵化为私有实验性服务

Status: implemented

[English](2026-09-03-experimental-module-scheduler.md) | 中文

## 问题

多个主会话需要调用不可变模块定义，并拥有独立的运行身份、模块级并发上限、有限队列和按运行范围取消的能力。现有工作流与 Agent Teams 包负责不同的生命周期语义，适配层不能重新定义调度状态或结果校验。

## 决策

私有包 `@deepseek-ai/dsh-experimental-module-scheduler` 负责模块定义、运行状态、相互独立的全局与模块级队列准入、取消、结果校验和 Cordis 服务。ToolRuntime 适配层把普通 Host 工具调用映射到运行器，独立的私有 Host 注册表则提供仅供模块使用、不会发布模型工具 schema 的工具。显式 profile 覆盖层可以使用该注册表提供单文件开发助手，而不会把它加入 bundle 的默认 patch：每个开发工具都会校验精确的助手模块身份，写入会比较同次运行读取的内容，固定验证命令通过受管子进程服务在根目录限定为目标 profile 的只读沙箱中执行。释放 Cordis 服务会取消排队和运行中的任务，之后的新提交会以 `blocked` 和 `disposed` 原因拒绝。该包加入 Host TypeScript 和库构建图，但仍位于 `packages/experimental` 下，并排除在受支持的 profile bundle 和发布包之外。

构建产物覆盖会在 Host 库构建后，通过普通 Node 导入 `lib/index.js`。源码测试覆盖调度和 ToolRuntime 行为，不依赖构建产物。

## 曾考虑的替代方案

把这些语义加入工作流、Agent Teams 或 UI 适配层，会让其他子系统拥有模块运行状态，并导致跨入口行为漂移。把该包放进默认 profile，会在运行时集成完成前把孵化中的合同变成受支持的产品界面。

## 后果

DSH 可以使用常规 Host 门禁编译、打包和测试调度器，同时保持实验性发布边界。未来 promotion 需要单独决定公开包和 profile；当前不保留实验包名称的兼容别名。
