# Agent Note: Agent-step model routing

Status: implemented

English | [中文](2026-09-05-agent-step-model-routing.zh.md)

## Problem

Agent model selection already snapshots one route across prompt assembly and `agent/request`, and subagents inherit the latest logged request route. Task routing needs the claimed user input before that snapshot; `agent/pre-step` runs after prompt assembly and is therefore too late.

## Decision

The Agent loop exposes the `agent/route-step` waterfall after inbox claim and before prompt assembly. An experimental plugin classifies only new human-authored text, updates the Agent scope's installed `ModelSelectionRef`, and appends `model/routing-decision`; `request/header` remains the executed-route record. Explicit `model/selection` intent wins, while tool-result continuation steps keep the current route.

The initial policy maps lightweight work to Luna, architecture, complex debugging, and high-risk work to Sol, and everything else to Terra. Deployments configure exact provider/model routes; price and context-window metadata do not participate.

## Alternatives considered

Putting routing in presets was rejected because presets own session composition rather than per-step task decisions. Putting it in modules or the GUI was rejected because modules must inherit the resolved Agent route and clients must consume, not recreate, runtime decisions. Routing in `agent/pre-step` was rejected because prompt assembly has already captured the request route.

## Consequences

Prompt variables, the model request, and `request/header` use one step snapshot. Modules and managed children require no model-selection logic. The deterministic classifier is deliberately experimental; failure escalation and a distinct review route remain separate future policies.

## Verification

Core interception tests pin `route-step` before assembly and pre-step admission. Experimental package tests pin all three tiers, explicit-selection priority, tool continuation, the durable reason event, and the actual request header. Existing child-option tests pin inheritance from the latest request header.
