---
description: "Run bounded Android SDK and adb diagnostics without shell command strings."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-android-tooling

English | [中文](README.zh.md)

## Summary

Callers can discover Android tools, run fixed argument vectors through `ctx.subprocess`, and parse connected devices. Output and execution time stay bounded. The package does not accept arbitrary commands or modify projects and devices.

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

Use `createAndroidTooling(ctx.subprocess)` from a host module that owns fixed command and argument templates. A successful call returns bounded stdout, stderr, exit facts, truncation, and timeout state.

### When to choose it

Choose this adapter when an Android module needs local tool discovery or controlled process execution. Use the shared subprocess package directly only for non-Android commands.

### Minimal configuration

The adapter is created from the active subprocess service; it has no profile configuration of its own.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The adapter delegates process-tree ownership, cancellation, and collected output to the shared subprocess seam. It adds Android path discovery, a ten-second command deadline, and `adb devices -l` parsing.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Subprocess capability](../../subprocess/subprocess/README.md)
- [Android diagnostics](../android-environment-diagnostics/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Android tooling output

#### What the model sees

A consuming diagnostic or development module may project bounded `createAndroidTooling` command results into a session. This package adds no prompt or model-visible tool.

#### Token effect

Only a consuming module can add returned output to model context.

#### KV Cache effect

A projected result can change later request prefixes; the consuming module owns that projection.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Local host only** — the first implementation uses the active host subprocess provider.
- **Windows fallback paths** — built-in fallback locations target the verified workstation toolchain.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
