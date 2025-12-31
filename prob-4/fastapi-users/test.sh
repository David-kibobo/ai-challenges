#!/usr/bin/env bash
set -e

if [ "$1" = "base" ]; then
    echo "Running baseline tests (ignoring failing base tests)..."
    python -m pytest -q tests \
        --ignore=tests/test_missing_sessions.py \
        --ignore=tests/test_authentication_strategy_redis.py \
       

        
elif [ "$1" = "new" ]; then
    echo "Running new tests..."
    python -m  pytest  -q tests/test_missing_sessions.py
else
    echo "Usage: ./test.sh [base|new]"
    exit 1
fi
# Ready for submission
