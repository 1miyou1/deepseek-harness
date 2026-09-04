---
description: "Private host profile layer for the experimental module scheduler service."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-module-scheduler-profile

English | [中文](README.zh.md)

## Summary

Private host profile layer for the experimental module scheduler service and its real `network-research` module. It is an opt-in layer and is not included in official shipped profiles.

## Table of Contents

- [Usage](#usage)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="usage"></a>
## Usage

Add this bundle to a source-checkout profile to load the scheduler and register `network-research@1.0.0`. The module accepts one `query`, searches through the profile's configured `ctx.web` provider with an eight-source cap, and returns its structured summary and sources.

<a id="model-experience"></a>
## Model Experience

### Profile composition

#### What the model sees

This bundle changes profile composition and registers a host-side `ctx.web` workload; it adds no model prompt or model-visible tool.

#### Token effect

This bundle adds no prompt text or model tool schema of its own.

#### KV Cache effect

This bundle does not change model request prefixes by itself.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Private opt-in only** — official shipped profiles do not load this bundle.
- **No persistence** — the layer does not persist process or browser state.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance</summary>

This package is experimental and follows the repository package and profile contracts.
</details>
