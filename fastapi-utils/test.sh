#!/usr/bin/env bash
set -e

if [ "$1" = "base" ]; then
    echo "Running baseline tests (ignoring failing base tests)..."
    python -m pytest -q tests \
        --ignore=tests/test_async_session_maker_missing.py \
     
       

        
elif [ "$1" = "new" ]; then
    echo "Running new tests..."
    python -m  pytest  -q tests/test_async_session_maker_missing.py
else
    echo "Usage: ./test.sh [base|new]"
    exit 1
fi
# Ready for submission
