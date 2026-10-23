#!/bin/bash
# Cloud-session bootstrap: pin Bun to the project's version and install dependencies.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

BUN_VERSION="1.4.4"
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
BUN_BIN="$BUN_INSTALL/bin/bun"

# The cloud image sets BUN_OPTIONS=--smol, which breaks `bun upgrade`; clear it for these calls.
current="$(BUN_OPTIONS= "$BUN_BIN" --version 2>/dev/null || echo none)"
if [ "$current" != "$BUN_VERSION" ]; then
  echo "Installing Bun $BUN_VERSION (found: $current)" >&2
  curl -fsSL https://bun.com/install | BUN_OPTIONS= bash -s "bun-v$BUN_VERSION" >&2
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
if [ -f package.json ]; then
  BUN_OPTIONS= "$BUN_BIN" install >&2
fi
