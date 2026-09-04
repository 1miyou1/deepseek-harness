---
description: "Inspect Android projects, toolchains, devices, and installed application versions."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-android-environment-diagnostics

English | [中文](README.zh.md)

## Summary

Users can diagnose an explicit Android project path, local tool versions, connected devices, Android releases, and an optional application package. Environment faults remain structured diagnostic items instead of becoming false module failures. The package does not build, install, launch, test, or modify an Android project or device.

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

The profile module calls `diagnose(input, tooling, signal)` with an explicit `projectPath`. Optional `deviceSerial` and `packageName` fields narrow device and package inspection.

### When to choose it

Choose this package for read-only Android environment checks. Use later development, debugging, or testing modules when the task must change a project, device, or application.

### Minimal configuration

Provide `projectPath`. Add `includeDevices`, `deviceSerial`, or `packageName` only when the corresponding inspection is needed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package recognizes Gradle project markers, asks the tooling adapter for bounded process results, and maps tool and device faults into a stable diagnostic vocabulary.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Android tooling](../android-tooling/README.md)
- [Module Scheduler](../module-scheduler/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Diagnostic result

#### What the model sees

A consuming `android-environment-diagnostics` module may project a completed diagnostic result into a session. This package adds no prompt or model-visible tool.

#### Token effect

Only the consuming module's result projection can add returned output to model context.

#### KV Cache effect

A projected result can change later request prefixes; the consuming module owns that projection.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Authorized device required** — Android version and package inspection require an online authorized device.
- **Read-only scope** — build, install, launch, log capture, and tests belong to later modules.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
