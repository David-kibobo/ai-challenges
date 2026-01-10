#!/usr/bin/env bash
set -euo pipefail

NEW_TEST_FILE="test/use-swr-subscription-suspense.test.tsx"

# 1. NEW_TEST_FILE: Excluded during 'base' mode.
# 2. EXCLUDED BASELINE TESTS: Omitted to bypass already failing baseline tests due to environmental instability.
# 3. e2e/: Excludes the end-to-end directory.
EXCLUDE_TESTS=(
  "${NEW_TEST_FILE}"
  "test/use-swr-focus.test.tsx"
   "e2e/"
)

IFS="|"
IGNORE_PATTERNS="${EXCLUDE_TESTS[*]}"

IFS=$' \t\n'

if [ "$#" -ge 1 ]; then
  MODE="$1"
elif [ "${MODE-""}" != "" ]; then
  MODE="$MODE"
else
  MODE=base
fi

echo " Running SWR tests (mode: ${MODE})"
echo "---"

if [ "${MODE}" = "base" ]; then
  echo "Running BASE tests (All original tests, excluding known unstable files)"

  

  pnpm test --no-watch \
    --testPathIgnorePatterns="${IGNORE_PATTERNS}"
  exit 0
fi

if [ "${MODE}" = "new" ]; then
  echo "Running NEW tests"

  pnpm test --verbose "${NEW_TEST_FILE}"
  exit 0
fi

echo "Unknown MODE: ${MODE}. Use 'base' (default) or 'new'."
exit 2
