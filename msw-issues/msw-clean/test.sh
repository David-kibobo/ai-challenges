#!/usr/bin/env bash
set -euo pipefail

# Determine mode
if [ "$#" -ge 1 ]; then
  MODE="$1"
elif [ "${MODE-""}" != "" ]; then
  MODE="$MODE"
else
  MODE=base
fi

echo "Running tests (mode: ${MODE})"


EXCLUDES=(
  "third-party/axios-error-response.test.ts"
  "third-party/axios-upload.node.test.ts"
  "msw-api/setup-server/resetHandlers.node.test.ts"
  "msw-api/setup-server/scenarios/fall-through.node.test.ts"
  "msw-api/setup-server/scenarios/on-unhandled-request/callback.node.test.ts"
  "msw-api/setup-server/scenarios/on-unhandled-request/default.node.test.ts"
)


EXCLUDE_ARGS=()
for pat in "${EXCLUDES[@]}"; do
  EXCLUDE_ARGS+=( "--exclude=${pat}" )
done

if [ "${MODE}" = "base" ]; then
  echo "Running base tests"
  pnpm -s build


  pnpm -s vitest --run --config=./test/node/vitest.config.ts "${EXCLUDE_ARGS[@]}"
  exit 0
fi

if [ "${MODE}" = "new" ]; then
  echo "Running experimental tests"
    pnpm -s build
  pnpm -s vitest --run --config=./test/cleanup-tests/vitest.config.ts || exit 1
  exit 0
fi

echo "Unknown MODE: ${MODE}. Use MODE=base or MODE=new"
exit 2
