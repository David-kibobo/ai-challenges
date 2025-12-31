#!/usr/bin/env bash
set -euo pipefail

# Directories & FIFO
mkdir -p src/pipe src/logs
[ -p src/pipe/events.fifo ] || mkfifo src/pipe/events.fifo

# Make sure run.sh is executable
chmod +x src/run.sh

# Execute the supervisor
cd src && ./run.sh

