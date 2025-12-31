#! /bin/bash
TEST_DIR=tests   # <- point this to your tests folder
uv run pytest $TEST_DIR/test_outputs.py -rA
