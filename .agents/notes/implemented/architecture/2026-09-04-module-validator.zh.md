# Agent Note: 新增模块自动校验器

Status: implemented

[English](2026-09-04-module-validator.md) | 中文

## 问题

实验模块校验需要一个有上限的 Host 侧路径，且不调用模型、不启动 Agent、不改变源文件。

## 决策

profile 注册 `module-validator@1.0.0`。校验器先把目标模块复制到临时隔离目录，再通过只读 sandbox 和受管 subprocess 在副本中执行固定的 test、lint、typecheck，结束后删除副本，并发布包含稳定错误码、失败步骤和已执行结果的有上限结果。

## 考虑过的替代方案

使用开发助手会要求模型和 Agent。让调用方提供命令或修改文件会扩大执行权限。

## 后果

测试覆盖命令失败、启动失败、超时、清理、路径、输出上限、真实 subprocess 执行、Windows ACL 直接写入拒绝、内容不变和性能。
