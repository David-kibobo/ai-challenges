#!/usr/bin/env bash
set -euo pipefail


NEW_TEST_FILE="./test/modules/WebSocket/websocket-error.test.ts"



# 2. Path definitions for the *Exclusion Logic* (needed by local Vitest runner).
# We strip the leading "./test/" because Vitest reports paths relative to its 'root'.
NEW_TEST_FILE_EXCLUDE="${NEW_TEST_FILE#./test/}"



# Determine mode
if [ "$#" -ge 1 ]; then
  MODE="$1"
elif [ "${MODE-""}" != "" ]; then
  MODE="$MODE"
else
  MODE=base
fi

echo "Running tests (mode: ${MODE})"


EXCLUDE_TESTS=(
  "${NEW_TEST_FILE_EXCLUDE}"
  "modules/fetch/compliance/fetch-response-non-configurable.test.ts"
  "modules/http/regressions/http-socket-timeout.test.ts"
  "modules/http/compliance/http-ssl-socket.test.ts"
  "modules/http/compliance/http-timeout.test.ts"
)


EXCLUDE_ARGS=()
for pat in "${EXCLUDE_TESTS[@]}"; do
  EXCLUDE_ARGS+=( "--exclude=${pat}" ) 
done

if [ "${MODE}" = "base" ]; then
  echo "Running base tests (excluding new test)"
#    pnpm -s build
  
  
  pnpm -s vitest --run --config=./test/vitest.config.js "${EXCLUDE_ARGS[@]}"
  exit 0
fi

if [ "${MODE}" = "new" ]; then
  echo "Running experimental tests (only new test)"
    #  pnpm -s build
  
  # Run *only* the new test file (using the full path)
  pnpm -s vitest --run --config=./test/vitest.config.js "${NEW_TEST_FILE}"
  exit 0
fi

echo "Unknown MODE: ${MODE}. Use MODE=base or MODE=new"
exit 2
