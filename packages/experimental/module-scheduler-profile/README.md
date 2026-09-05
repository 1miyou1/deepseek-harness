---
description: "Private host profile layer for the experimental module scheduler service."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-module-scheduler-profile

English | [中文](README.zh.md)

## Summary

Private host profile layer for deterministic Luna, Terra, and Sol Agent routing, the experimental module scheduler service, its `network-research` workload, and a restricted module-development assistant. It is an opt-in layer and is not included in official shipped profiles.

## Table of Contents

- [Usage](#usage)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="usage"></a>
## Usage

Add this bundle to a source-checkout profile to enable configured Luna, Terra, and Sol step routing, load the scheduler, and register `network-research@1.0.0`. The routing plugin records its reason while `request/header` records the route actually used. The module developer is exported but deliberately absent from the default patch. Opt in by adding both entries to a later profile patch:

```yaml
- insert:
    - id: module-developer-tools
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/module-dev-tools'
    - id: module-developer
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/module-developer'
```

The current conversation model can invoke `module-developer@1.0.0` for one prescribed compare-and-replace or `module-developer@2.0.0` for a bounded multi-step task. Version 2 starts one fresh in-process child that inherits the initiating model route, sees only the five child-scoped development tools plus `structured_output`, and runs at most 12 model steps with 4,096 output tokens per request. The Host keeps the same module-id, path, symlink, sensitive-file, existing-file, compare-before-write, sandbox, subprocess, bounded-output, and cancellation restrictions for both versions.

<a id="model-experience"></a>
## Model Experience

### Profile composition

#### What the model sees

The default bundle changes profile composition and registers a host-side `ctx.web` workload without loading the development assistant. After explicit opt-in, the parent model reaches both developer versions through the scheduler's single `module_run` tool. Private development tools stay out of the parent catalog; version 2 projects them only into its managed child's scope.

#### Token effect

The private Host tools add no schemas to the ordinary model tool catalog; the assistant adds no prompt text.

#### KV Cache effect

The private tools do not change the stable model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Two explicit opt-ins** — official shipped profiles do not load this bundle, and the bundle's default patch does not load the development assistant.
- **No persistence** — the layer does not persist process or browser state.
- **Versioned execution modes** — `module-developer@1.0.0` performs one prescribed single-file replacement; `module-developer@2.0.0` delegates a bounded multi-step task to one fresh child, but it does not create files, use Agent Teams, use continuable children, or claim a cumulative token budget.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance</summary>

This package is experimental and follows the repository package and profile contracts.
</details>
