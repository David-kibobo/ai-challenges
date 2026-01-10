#!/usr/bin/env bash
set -e

NEW_TEST_FILE="fsspec/tests/test_simplecache_leak.py"

if [ "$1" = "base" ]; then
    echo "Running baseline tests (60s per-test timeout)..."
    
    python -m pytest -q  fsspec/tests \
        --ignore="$NEW_TEST_FILE" \
	    -k "not test_chained_equivalent"
        
elif [ "$1" = "new" ]; then
    echo "Running new test verification..."
    
    python -m pytest -v  --timeout=60 "$NEW_TEST_FILE"

else
    echo "Usage: ./test.sh [base|new]"
    exit 1
fi
