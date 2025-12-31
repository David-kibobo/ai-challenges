#! /bin/bash
TEST_DIR=tests 
uv run pytest $TEST_DIR/test_outputs.py -rA
