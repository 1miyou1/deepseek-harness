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

Add this bundle to a source-checkout profile to enable configured Luna, Terra, and Sol step routing, load the scheduler, and register `network-research@1.0.0`. The profile must provide the compatible `@deepseek-ai/dsh-tools` peer; the bundle does not install a private Tool Runtime copy. The routing plugin records its reason while `request/header` records the route actually used. The module developer is exported but deliberately absent from the default patch. Apply `cordis.developer.patch.yml`, which contains both required entries:

```yaml
- insert:
    - id: module-developer-tools
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/module-dev-tools'
    - id: module-developer
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/module-developer'
```

The current conversation model can invoke `module-developer@1.0.0` for one prescribed compare-and-replace, `module-developer@2.0.0` for a bounded multi-step edit, or `module-developer@3.0.0` to build a new module from the repository scaffold. Version 3 requires an explicit `luna` or `terra` tier and rejects Sol, creates the scaffold before starting one fresh in-process child, exposes only existing-file edit and validation tools to that child, and removes a failed scaffold through the generator's guarded rollback. Versions 2 and 3 cap each request at 4,096 output tokens and run at most 12 and 24 model steps respectively.

Add `cordis.organizer.patch.yml` as a separate optional layer to register `document-organizer@1.0.0`. Each call supplies an explicit list of Markdown or `.i18n.yaml` paths and one organization task. The module asks Luna for a structured plan, retries once with Terra only when the managed child reports a model or transport error, and never selects Sol. The Host validates all declared paths before it updates, creates, or moves files and restores the original files when an operation or focused documentation check fails.

<a id="model-experience"></a>
## Model Experience

### Profile composition

#### What the model sees

The profile exposes the scheduler and its opt-in module tools through the following model-facing surfaces.

##### Profile composition

```markdown
The default bundle changes profile composition and registers a host-side `ctx.web` workload without loading the development assistant. After explicit opt-in, the parent model reaches all developer versions through the scheduler's single `module_run` tool. Private development tools stay out of the parent catalog; managed versions project only their bounded edit and validation tools into fresh child scopes.
```

##### Module validator

```markdown
It copies the selected module into a temporary isolated directory, then executes fixed `test`, `lint`, and `typecheck` commands there in sequence through the sandbox and managed subprocess seam. The temporary copy is removed after the run. It does not write target files, call a model, or start an Agent. Its performance test covers only the local validation flow.
```

##### Document organizer

```markdown
It accepts an explicit document path list and organization task, uses Luna to produce one structured plan, falls back once to Terra only after a managed model or transport error, and never uses Sol. Validated updates, creations, and content-preserving moves are applied together and rolled back when an operation or focused documentation check fails.
```

#### Token effect

The private Host tools add no schemas to the ordinary model tool catalog. Managed organizer and developer runs add only their bounded task, scoped tools, and structured output schema to a fresh child.

#### KV Cache effect

The private tools do not change the stable model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Explicit optional layers** — official shipped profiles do not load this bundle, and its default patch loads neither the development assistant nor the document organizer; use the dedicated optional patches.
- **No persistence** — the layer does not persist process or browser state.
- **Versioned execution modes** — version 1 performs one prescribed replacement, version 2 edits an existing module, and version 3 creates one fixed scaffold before bounded edits; none use Agent Teams or continuable children, and the managed step token limit is per request rather than cumulative.
- **Best-effort rollback** — the organizer restores captured file contents after controlled failures, but abrupt process termination can interrupt restoration. The runtime exposes model and transport failures through one managed-child error class, so Terra fallback cannot identify a narrower provider outage.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintenance</summary>

This package is experimental and follows the repository package and profile contracts.
</details>
