# Agent Note: Add module validator

Status: implemented

English | [中文](2026-09-04-module-validator.zh.md)

## Problem

Experimental module validation needed a bounded Host-side path that does not call a model, start an Agent, or change source files.

## Decision

The profile registers `module-validator@1.0.0`. The validator copies the selected module into a temporary isolated directory, runs fixed test, lint, and typecheck commands there through the read-only sandbox and managed subprocess seam, removes the copy after completion, and publishes one bounded result with stable error codes, the failed step, and executed results.

## Alternatives considered

Using the development assistant would require a model and Agent. Letting callers supply commands or mutate files would widen the execution authority.

## Consequences

Tests cover command failures, startup failure, timeouts, cleanup, paths, output limits, real subprocess execution, Windows ACL direct-write rejection, preservation, and performance.
