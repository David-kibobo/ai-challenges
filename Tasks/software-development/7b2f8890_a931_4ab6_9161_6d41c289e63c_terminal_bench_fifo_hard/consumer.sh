#!/usr/bin/env bash
set -euo pipefail
cat pipe/events.fifo | awk -f consumer.awk
