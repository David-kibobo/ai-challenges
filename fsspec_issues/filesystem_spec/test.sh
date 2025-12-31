#!/usr/bin/env bash
set -e

if [ "$1" = "base" ]; then
    echo "Running baseline tests (ignoring failing base tests)..."
    python -m pytest -q fsspec/tests \
        --ignore=fsspec/tests/test_dirfs.py \
        --ignore=fsspec/tests/test_api.py::test_chained_equivalent 
elif [ "$1" = "new" ]; then
    echo "Running new tests..."
    python -m pytest -q fsspec/tests/test_dirfs.py
else
    echo "Usage: ./test.sh [base|new]"
    exit 1
fi
