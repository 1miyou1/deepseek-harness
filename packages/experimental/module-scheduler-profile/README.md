---
description: "Private host profile layer for the experimental module scheduler service."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-module-scheduler-profile

English | [中文](README.zh.md)

## Summary

Private host profile layer for the experimental module scheduler service, its `network-research` workload, and a restricted module-development assistant. It is an opt-in layer and is not included in official shipped profiles.

## Table of Contents

- [Usage](#usage)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="usage"></a>
## Usage

Add this bundle to a source-checkout profile to load the scheduler and register `network-research@1.0.0` plus `module-developer@1.0.0`. The development assistant reads and compare-and-replaces one existing file inside `packages/experimental/<id>-profile`, then runs fixed `test`, `lint`, and no-emit `typecheck` actions. The Host rejects invalid module ids, parent or absolute paths, symbolic-link escapes, sensitive filenames, missing files, and content changed since the read. Validation runs through the managed subprocess service with a credential-scrubbed environment, bounded output, run cancellation, and a read-only Host sandbox rooted at the target profile.

<a id="model-experience"></a>
## Model Experience

### Profile composition

#### What the model sees

This bundle changes profile composition and registers a host-side `ctx.web` workload plus five private development tools. Only `module-developer@1.0.0`, which declares the exact names, can call these tools; they are not added to the ordinary model tool catalog, and the bundle adds no model prompt.

#### Token effect

The private Host tools add no schemas to the ordinary model tool catalog; the assistant adds no prompt text.

#### KV Cache effect

The private tools do not change the stable model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Private opt-in only** — official shipped profiles do not load this bundle.
- **No persistence** — the layer does not persist process or browser state.
- **Single-file replacement** — the first assistant pass compare-and-replaces one existing module file and runs fixed validation; it does not create files, emit typecheck build artifacts, build a complete module, or iterate autonomously.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance</summary>

This package is experimental and follows the repository package and profile contracts.
</details>
