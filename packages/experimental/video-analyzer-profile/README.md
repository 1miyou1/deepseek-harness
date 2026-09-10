---
description: "Private scaffold for the 视频分析器 Module Scheduler profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-video-analyzer-profile

English | [中文](README.zh.md)

## Summary

Dedicated video transcription, segmentation, and analysis module for DSH.
Uses local SenseVoice ASR and PyAV audio extraction for zero-cost, private processing.

## Verification

Run `node ./node_modules/vitest/vitest.mjs run packages/experimental/video-analyzer-profile` to verify.

## Model Experience

Zero external API cost; runs local ASR model.

#### KV Cache effect

None until loaded into a profile.

## Known Limitations and Deferred Work

- Requires local Python with PyAV and FunASR configured for real execution.

### Dev Note

None.
