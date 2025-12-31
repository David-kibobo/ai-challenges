#!/usr/bin/env bash
set -euo pipefail

# Idempotency
exec 9>run.lock
flock -n 9 || { echo "Another run in progress"; exit 1; }

mkdir -p pipe logs
[ -p pipe/events.fifo ] || mkfifo pipe/events.fifo
: > alerts.txt
rm -f timeline.json summary.json producer_lines.txt rotations.txt *.pid

now_ms() { python3 -c "import time; print(int(time.time() * 1000))"; }

# Start consumer first (inline pipeline required by tests)
CONS_START=$(now_ms)
cat pipe/events.fifo | awk -f consumer.awk &
CONS_PID=$!

# Tiny delay to ensure consumer is ready
sleep 0.3

# Start producer (must be backgrounded)
PROD_START=$(now_ms)
python3 producer.py > pipe/events.fifo &
PROD_PID=$!

echo "$PROD_PID" > producer.pid
echo "$CONS_PID" > consumer.pid

cleanup(){
  kill -TERM "$PROD_PID" "$CONS_PID" 2>/dev/null || true
  wait "$PROD_PID" 2>/dev/null || true
  wait "$CONS_PID" 2>/dev/null || true
}
trap cleanup INT TERM

# Let it run ~32s
sleep 32
cleanup

PROD_END=$(now_ms)
CONS_END=$(now_ms)

# Count rotations present & non-trivial
ROT=0
for f in logs/events.log.1 logs/events.log.2 logs/events.log.3; do
  if [ -s "$f" ]; then ROT=$((ROT+1)); fi
done

PL=0; AL=0
[ -f producer_lines.txt ] && PL=$(cat producer_lines.txt)
[ -f alerts.txt ] && AL=$(grep -c '^ALERT ' alerts.txt || true)

# Write JSON summaries (include both keys for compatibility)
cat > write_json.py <<EOF
import json
n = int("$PL")
summary = {
    "producer_lines_total": n,
    "producer_lines": n,
    "alerts": int("$AL"),
    "rotations_min": int("$ROT"),
    "parallel": True,
}
timeline = {
    "consumer_start_ms": int("$CONS_START"),
    "producer_start_ms": int("$PROD_START"),
    "consumer_end_ms": int("$CONS_END"),
    "producer_end_ms": int("$PROD_END"),
}
open("summary.json","w").write(json.dumps(summary))
open("timeline.json","w").write(json.dumps(timeline))
EOF
python3 write_json.py

echo DONE
