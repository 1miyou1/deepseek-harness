---
description: "Private Web profile layer for the experimental module scheduler console."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-module-scheduler-web-profile

English | [中文](README.zh.md)

## Summary

Private Web profile layer for the experimental module scheduler console. It is an opt-in layer and is not included in official shipped profiles.

## Table of Contents

- [Usage](#usage)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="usage"></a>
## Usage

Add this bundle to a source-checkout profile to load the module scheduler service through its patch.

<a id="model-experience"></a>
## Model Experience

### Profile composition

#### What the model sees

This bundle changes profile composition only; `cordis.patch.yml` inserts the service or UI package that owns model-facing behavior.

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
