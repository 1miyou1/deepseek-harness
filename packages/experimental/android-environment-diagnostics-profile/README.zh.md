---
description: "向实验 DSH profile 加入只读 Android 环境诊断。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-android-environment-diagnostics-profile

[English](README.md) | 中文

## 概述

Profile 通过此层获得 `android-environment-diagnostics@1.0.0`。现有模块控制台可以使用显式工程路径启动诊断。模块使用 Host 子进程 provider，不增加专用 Android 界面。

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

私有 `web` profile 从源码 checkout 链接此 bundle。其补丁在模块调度器和本地子进程 provider 可用后插入诊断模块。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节——点击展开</summary>

`cordis.patch.yml` 插入一个注册插件。该插件从 `ctx.subprocess` 创建 Android 工具适配器，并注册具有有界调度策略的无工具模块。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Android 诊断](../android-environment-diagnostics/README.zh.md)
- [模块调度 Profile](../module-scheduler-profile/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 诊断结果

#### 模型会看到什么

插入的 `android-environment-diagnostics` 模块可以将完成的诊断结果投影到会话；此 bundle 不增加提示词或模型可见工具。

#### Token 影响

只有插入模块的结果投影可以将 token 加入模型上下文。

#### KV Cache 影响

模块调度器拥有投影结果造成的任何缓存前缀变化。

## 已知限制和后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅供私有选择性启用**——官方 shipped profile 不加载此 bundle。
- **没有专用界面**——用户通过现有模块控制台输入 JSON。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
