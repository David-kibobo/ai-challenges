#!/usr/bin/env bash
set -e

if [ "$1" = "base" ]; then
    echo "Running baseline tests (ignoring failing or flaky tests)..."
    python -m pytest -q tests \
        --ignore=tests/sync/test_pong_waiters_race.py \
        --ignore=tests/test_authentication_strategy_redis.py \
        --ignore=tests/legacy/test_protocol.py \
        --ignore=tests/asyncio/test_connection.py \
        --ignore=tests/asyncio/test_server.py \
        --ignore=tests/asyncio/test_client.py \
        --ignore=tests/sync/test_connection.py \
        --ignore=tests/sync/test_client.py \
        --ignore=tests/sync/test_messages.py  \
        --ignore=tests/sync/tests/sync/test_server.py

elif [ "$1" = "new" ]; then
    echo "Running new tests..."
    python -m pytest -q  tests/sync/test_pong_waiters_race.py
else
    echo "Usage: ./test.sh [base|new]"
    exit 1
fi


