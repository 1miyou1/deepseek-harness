---
description: "不使用 shell 命令字符串，执行有界的 Android SDK 与 adb 诊断。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-android-tooling

[English](README.md) | 中文

## 概述

调用方可以发现 Android 工具，通过 `ctx.subprocess` 执行固定参数向量，并解析连接设备。输出和执行时间都有上界。此包不接受任意命令，也不修改工程与设备。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在拥有固定命令与参数模板的 Host 模块中使用 `createAndroidTooling(ctx.subprocess)`。成功调用返回有界的 stdout、stderr、退出信息、截断和超时状态。

### 选择条件

当 Android 模块需要本地工具发现或受控进程执行时选择此适配器。只有非 Android 命令才直接使用共享子进程包。

### 最小配置

适配器从当前子进程服务创建；它没有自己的 profile 配置。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节——点击展开</summary>

适配器将进程树所有权、取消和输出收集委托给共享子进程 seam。它增加 Android 路径发现、十秒命令截止时间和 `adb devices -l` 解析。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [子进程能力](../../subprocess/subprocess/README.zh.md)
- [Android 诊断](../android-environment-diagnostics/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### Android 工具输出

#### 模型会看到什么

消费诊断或开发模块可以将有界 `createAndroidTooling` 命令结果投影到会话；此包不增加提示词或模型可见工具。

#### Token 影响

只有消费模块可以将返回输出加入模型上下文。

#### KV Cache 影响

投影结果可能改变后续请求前缀；消费模块拥有该投影。

## 已知限制和后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限本地 Host**——首个实现使用当前 Host 子进程 provider。
- **Windows 回退路径**——内置回退位置面向已验证的工作站工具链。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
