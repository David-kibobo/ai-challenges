#!/usr/bin/env bash
# solution.sh — Easy task: assumes all files are provided, including consumer.awk, producer.py, run.sh, write_json.py
set -euo pipefail

# Directories & FIFO
mkdir -p pipe logs
[ -p pipe/events.fifo ] || mkfifo pipe/events.fifo


chmod +x run.sh

# Execute the supervisor
./run.sh
