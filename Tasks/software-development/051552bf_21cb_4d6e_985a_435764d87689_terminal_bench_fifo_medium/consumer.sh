#!/usr/bin/env bash
set -euo pipefail
cat pipe/events.fifo | awk -f app/src/consumer.awk
