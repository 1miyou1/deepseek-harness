---
description: "检查 Android 工程、工具链、设备和已安装应用版本。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-android-environment-diagnostics

[English](README.md) | 中文

## 概述

用户可以诊断显式 Android 工程路径、本地工具版本、连接设备、Android 版本和可选应用包。环境故障保持为结构化诊断项，不会变成虚假的模块失败。此包不构建、安装、启动、测试或修改 Android 工程与设备。

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

Profile 模块使用显式 `projectPath` 调用 `diagnose(input, tooling, signal)`。可选 `deviceSerial` 和 `packageName` 字段用于限定设备和应用检查。

### 选择条件

只读 Android 环境检查应选择此包。任务需要修改工程、设备或应用时，使用后续开发、调试或测试模块。

### 最小配置

提供 `projectPath`。只有需要对应检查时才增加 `includeDevices`、`deviceSerial` 或 `packageName`。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节——点击展开</summary>

此包识别 Gradle 工程标志，向工具适配器请求有界进程结果，并将工具与设备故障映射到稳定的诊断词汇。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Android 工具层](../android-tooling/README.zh.md)
- [模块调度器](../module-scheduler/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 诊断结果

#### 模型会看到什么

消费 `android-environment-diagnostics` 模块可以将完成的诊断结果投影到会话；此包不增加提示词或模型可见工具。

#### Token 影响

只有消费模块的结果投影可以将返回输出加入模型上下文。

#### KV Cache 影响

投影结果可能改变后续请求前缀；消费模块拥有该投影。

## 已知限制和后续工作

<a id="known-limitations-and-deferred-work"></a>

- **需要已授权设备**——Android 版本和应用检查需要在线且已授权的设备。
- **只读范围**——构建、安装、启动、日志采集和测试属于后续模块。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
