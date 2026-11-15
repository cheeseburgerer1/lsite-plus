#!/usr/bin/env bash
set -euo pipefail
deps="$(mktemp -d)"
trap 'rm -rf -- "$deps"' EXIT
npm install --prefix "$deps" --no-audit --no-fund --ignore-scripts --omit=optional \
  @wllama/wllama@3.13.0 @wllama/wllama-compat@3.13.0 katex@0.19.1
node ai/build-runtime.mjs "$deps/node_modules"
