---
description: "Choose deterministic Luna, Terra, and Sol routes for new Agent tasks before prompt assembly."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-agent-step-model-router

English | [中文](README.zh.md)

## Summary

Use this package to select Luna for lightweight work, Sol for complex or high-risk work, and Terra for other new user tasks. The selected route applies before prompt assembly, so prompt variables and the provider request agree. Explicit model selection takes priority, and tool-result continuation retains the current route.

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

Mount the plugin after the Agent and Session projection services, and configure one exact route for each tier.

### When to choose it

Choose this package for a source-checkout profile that needs automatic per-task model routing. Avoid it when every Agent must use one fixed model or when a product needs a learned classifier.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-experimental-agent-step-model-router'
  config:
    luna: { provider: openai-codex, model: gpt-5.6-luna }
    terra: { provider: openai-codex, model: gpt-5.6-terra }
    sol: { provider: openai-codex, model: gpt-5.6-sol }
```

| Field | Default | Meaning |
|---|---|---|
| `luna` | required | Exact provider and model for lightweight tasks |
| `terra` | required | Exact provider and model for default tasks |
| `sol` | required | Exact provider and model for complex and high-risk tasks |

The generated [configuration catalog](../../../docs/config-catalog.md) is the exhaustive source for accepted fields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`agent/route-step` runs after inbox claim and before prompt assembly. The plugin classifies only new user text, updates the Agent scope model-selection reference, and records `model/routing-decision`; `request/header` records the route sent to the provider. Tool-result continuation has no new user task, so it keeps the current route.

| Source | Responsibility |
|---|---|
| [`src/router.ts`](src/router.ts) | Deterministic classification |
| [`src/index.ts`](src/index.ts) | Agent event integration and priority rules |
| [`src/projection.ts`](src/projection.ts) | Durable decision event and projection |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent-step routing decision](../../../.agents/notes/implemented/architecture/2026-09-05-agent-step-model-routing.md) — ownership and rejected placements.
- [Architecture](../../../docs/architecture.md#turn-flow) — Agent turn ordering and extension points.
- [Module Scheduler profile](../module-scheduler-profile/README.md) — opt-in profile composition.

-----

<a id="model-experience"></a>
## Model Experience

### Step routing

#### What the model sees

The plugin adds no prompt text or tools. `agent/route-step` selects the route before prompt assembly. Lightweight classification, extraction, summary, formatting, and batch tasks use Luna. Architecture, large-codebase, concurrency, root-cause, security, authorization, privacy, payment, production, migration, and destructive tasks use Sol. Other tasks use Terra, while explicit model selection bypasses automatic routing.

#### Token effect

The plugin adds no model-visible tokens.

#### KV Cache effect

A route change can start a different provider/model cache lineage. Tool-result continuation keeps the selected route.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The package intentionally provides a narrow first policy.

- Classification uses deterministic keyword matching over new user text; it does not call a model.
- Automatic failure escalation and separate review-model routing are not implemented.
- Official released profiles do not include this experimental package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
