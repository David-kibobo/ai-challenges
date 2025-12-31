#!/usr/bin/env bash
set -e

NEW_TEST_FILE="t/unit/utils/test_log_buffering.py"

# Bypassing root security checks for Docker environments
export C_FORCE_ROOT=1

# Targeted ignores for tests that fail due to Docker/Environment restrictions
TARGETED_IGNORES="--ignore=t/unit/utils/test_platforms.py \
                  --ignore=t/unit/app/test_preload_cli.py"

if [ "$1" = "base" ]; then
    echo "======================================================="
    echo "  RUNNING TARGETED BASELINE (With Timeout Protection)"
    echo "======================================================="
    
   
    # --timeout=60: Force kill any test (like worker subprocesses) that hangs > 60s
    python -m pytest -q -x --timeout=60 \
        t/unit/utils/ \
        t/unit/app/ \
        t/unit/worker/ \
        $TARGETED_IGNORES \
        --ignore="$NEW_TEST_FILE"
        
elif [ "$1" = "new" ]; then
    echo "======================================================="
    echo "  RUNNING NEW TEST VERIFICATION"
    echo "======================================================="
    
   
    python -m pytest -v --timeout=60 "$NEW_TEST_FILE"

else
    echo "Usage: ./test.sh [base|new]"
    exit 1
fi
