# Agent Note: Add a general document organizer module

Status: implemented

English | [中文](2026-09-06-document-organizer-module.zh.md)

## Problem

Repository documentation needs a bounded organizer that can update existing Markdown, create new documents, and move documents without assigning a Sol-class model to routine editorial work or leaving partial filesystem changes after a model failure.

## Decision

The profile registers `document-organizer@1.0.0` as an optional Agent-originated module. Each run accepts an explicit list of repository-relative Markdown or bilingual sidecar paths plus an organization task. Archived Agent Notes, absolute paths, traversal, symbolic links, sensitive paths, and files outside the declared set are rejected.

The module asks a fresh managed child for a structured change plan. It selects the configured Luna route explicitly. If that child ends with the runtime's model or transport error result, the module retries once with the configured Terra route. It never selects Sol. Path validation, invalid structured output, cancellation, filesystem failure, and documentation-gate failure do not trigger fallback.

The planning child's prompt contains only the declared file contents and no tools. Its result lists compare-before-write updates, new files, and content-preserving moves. The Host validates every operation before mutation, applies the complete plan with rollback copies, and then runs Agent Note, translation-pairing, and Markdown-link checks. A failed operation or check restores the original files and removes newly created targets.

The module bounds file count, total input bytes, plan bytes, Agent steps, output tokens per step, subprocess output, and total runtime through validated deployment configuration. Its result reports the route used, whether fallback occurred, changed paths, and focused check results.

## Alternatives considered

**Let the Agent edit directly.** A Luna failure could leave partial moves or writes for Terra to inherit, so the model only proposes a plan.

**Always use Terra or Sol.** Routine classification, restructuring, and rewriting do not justify the higher-cost route. Terra is retained only as one fallback and Sol is excluded.

**Scan all Git changes automatically.** Automatic discovery can absorb unrelated work in a dirty checkout, so callers must provide the complete file set explicitly.

## Verification

Tests prove explicit Luna selection, one Terra fallback on a managed model error, no Sol route, no fallback for validation or filesystem failures, path and archive rejection, compare-before-write behavior, new-file and move handling, rollback, cancellation, bounded output, lifecycle disposal, and focused documentation checks.

The optional profile patch does not load the module by default. The package README pair documents its model, token, KV-cache, mutation, rollback, and known-limit behavior, and all affected documentation gates pass.

## Consequences

The current managed-child result compresses model and transport failures into one `error` stop reason, so the fallback can distinguish that class from validation and Host failures but cannot identify a narrower provider outage. Multi-file rollback protects repository content but is not a filesystem transaction; process termination outside controlled cancellation can still interrupt restoration.
