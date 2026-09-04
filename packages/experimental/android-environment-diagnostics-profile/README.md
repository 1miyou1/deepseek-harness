---
description: "Add read-only Android environment diagnostics to an experimental DSH profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-android-environment-diagnostics-profile

English | [中文](README.zh.md)

## Summary

A profile gains `android-environment-diagnostics@1.0.0` from this layer. The existing module console can start the diagnostic with an explicit project path. The module uses the host subprocess provider and does not add a dedicated Android interface.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The private `web` profile links this bundle from the source checkout. Its patch inserts the diagnostic after the Module Scheduler and local subprocess provider are available.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`cordis.patch.yml` inserts one registration plugin. The plugin creates the Android tooling adapter from `ctx.subprocess` and registers a tool-free module with bounded scheduler policy.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Android diagnostics](../android-environment-diagnostics/README.md)
- [Module Scheduler profile](../module-scheduler-profile/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Diagnostic result

#### What the model sees

The inserted `android-environment-diagnostics` module may project a completed diagnostic result into a session. This bundle adds no prompt or model-visible tool.

#### Token effect

Only the inserted module's result projection can add tokens to model context.

#### KV Cache effect

The Module Scheduler owns any cache-prefix change caused by a projected result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Private opt-in only** — official shipped profiles do not load this bundle.
- **No dedicated UI** — users enter JSON through the existing module console.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
