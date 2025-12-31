#!/usr/bin/env bash
set -e

if [ "$1" = "base" ]; then
    echo "Running baseline tests (ignoring new retry statistics wrapped tests)..."                                                                              
    python -m pytest -q tests \
        --ignore=tests/test_retry_statistics_wrapped.py
elif [ "$1" = "new" ]; then
    echo "Running new tests for retry statistics with wrapped functions..."
    python -m pytest -q tests/test_retry_statistics_wrapped.py -v
else
    echo "Usage: ./test.sh [base|new]"
    exit 1
fi
