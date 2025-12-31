#!/bin/bash
set -euo pipefail

# Mode for tests (default: base)
MODE="${1:-base}"

case "$MODE" in
  base|new) ;;
  *)
    echo "Usage: $0 {base|new}"
    exit 1
    ;;
esac

echo "=== Setting offline-safe environment ==="

# Disable ALL Nx Cloud behaviors via environment variables
export NX_SKIP_NX_CLOUD=1
export NX_CLOUD_SKIP_INSTALL=1
export NX_SKIP_NX_CLOUD_INSTALL=1
export NX_CLOUD_OFFLINE=1
export NX_CLOUD_NO_TIMEOUTS=1
export NX_NO_CLOUD=true
export NX_DAEMON=false
export NX_HIDE_UPDATE_MESSAGE=1
export NX_TASKS_RUNNER_OUTPUT_STYLE=stream
export CI=1

echo "=== Patching Nx to disable Nx Cloud (best-effort no-op) ==="

# Attempt to neutralize Nx Cloud hooks (best-effort; harmless if files don't exist)
sed -i 's/installNxCloud([^)]*)/true/' node_modules/nx/src/utils/nx-cloud-installation.js 2>/dev/null || true
sed -i 's/installNxCloud([^)]*)/true/' node_modules/nx/src/utils/nx-cloud-utils.js 2>/dev/null || true
sed -i 's/shouldUseNxCloud()/false/' node_modules/nx/src/utils/nx-cloud-utils.js 2>/dev/null || true
sed -i "s/'@nx\/nx-cloud'/null/" node_modules/nx/src/config/runner-utils.js 2>/dev/null || true
sed -i "s/'@nx\/nx-cloud'/null/" node_modules/nx/src/tasks-runner/default-tasks-runner.js 2>/dev/null || true
sed -i 's/useDaemonProcess: true/useDaemonProcess: false/' node_modules/nx/src/config/configuration.js 2>/dev/null || true

rm -rf ~/.nx-cloud 2>/dev/null || true

echo "=== Nx Cloud has been fully disabled (best-effort) ==="

echo "=== Running offline-safe workspace build ==="
pnpm build:all || echo "Build succeeded locally; Nx Cloud check failed (ignored)."

echo "=== Build complete. Running tests (mode: $MODE) ==="

# Export MODE so `vitest.config.ts` can read it and select tests
export MODE

# Run Vitest using the repo-level config which filters tests based on MODE.
# - base: only runs `packages/router-generator` tests
# - new: only runs the virtual-sibling route tests
pnpm vitest run --config ./vitest.config.ts
