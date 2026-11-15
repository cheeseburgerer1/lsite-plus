#!/usr/bin/env bash
set -euo pipefail
deps="$(mktemp -d)"
trap 'rm -rf -- "$deps"' EXIT
npm install --prefix "$deps" --no-audit --no-fund --ignore-scripts --omit=optional \
  @huggingface/transformers@4.3.2 @wllama/wllama@3.13.0 @wllama/wllama-compat@3.13.0
node ai/build-runtime.mjs "$deps/node_modules"
