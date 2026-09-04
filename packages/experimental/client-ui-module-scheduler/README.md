---
description: "Private Web console for listing modules and controlling eligible runs."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-module-scheduler

English | [中文](README.zh.md)

## Summary

This private Web package adds a session-header console for registered modules and browser-eligible runs.

## Table of Contents

- [Usage](#usage)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="usage"></a>
## Usage

The console lists registered modules, validates JSON input, starts eligible runs, refreshes status, renders structured results, and cancels active runs.

<a id="model-experience"></a>
## Model Experience

### Console surface

#### What the model sees

The console is browser-only and does not add model context; its action is mounted by `src/client/mount.ts`.

#### Token effect

The package adds no prompt text or model tool schema.

#### KV Cache effect

The package does not change model request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Private opt-in only** — official shipped profiles do not load this package.
- **No persistence** — browser state is process-local and is not restored after restart.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance</summary>

This package is experimental and follows the repository package and profile contracts.
</details>
