#!/bin/sh
set -e

export CORAL_CONFIG_DIR="${CORAL_CONFIG_DIR:-/data/coral-config}"
export CORAL_BIN="${CORAL_BIN:-coral}"

mkdir -p "$CORAL_CONFIG_DIR"

# First boot: register community sources + bundled token sources.
if [ ! -f "$CORAL_CONFIG_DIR/config.toml" ]; then
  echo "Initializing Coral workspace at $CORAL_CONFIG_DIR ..."
  if [ -f /opt/coral-sources/community/osv/manifest.yaml ]; then
    coral source add --file /opt/coral-sources/community/osv/manifest.yaml || true
  fi
  if [ -f /opt/coral-sources/community/deps_dev/manifest.yaml ]; then
    coral source add --file /opt/coral-sources/community/deps_dev/manifest.yaml || true
  fi
  if [ -n "$GITHUB_TOKEN" ]; then
    echo "Registering github source ..."
    coral source add github || true
  fi
  if [ -n "$SLACK_TOKEN" ]; then
    echo "Registering slack source ..."
    coral source add slack || true
  fi
  if [ -n "$NOTION_API_KEY" ]; then
    echo "Registering notion source ..."
    coral source add notion || true
  fi
fi

echo "Coral: $(coral --version 2>/dev/null || echo 'not found')"
echo "Starting HarborGuard on port ${PORT:-10000} ..."

exec uv run uvicorn main:app --host 0.0.0.0 --port "${PORT:-10000}"
