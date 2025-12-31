

#!/usr/bin/env bash
set -euo pipefail

# --------------------------
# Idempotency lock
# --------------------------
exec 9>run.lock
flock -n 9 || { echo "Another run in progress"; exit 1; }

# --------------------------
# Directories & FIFO
# --------------------------
ROOT_DIR="./"
LOG_DIR="${ROOT_DIR}logs"
PIPE_DIR="${ROOT_DIR}pipe"
mkdir -p "$LOG_DIR" "$PIPE_DIR"
[ -p "$PIPE_DIR/events.fifo" ] || mkfifo "$PIPE_DIR/events.fifo"

ALERTS_FILE="${ROOT_DIR}alerts.txt"
SUMMARY_FILE="${ROOT_DIR}summary.json"
TIMELINE_FILE="${ROOT_DIR}timeline.json"
PRODUCER_LINES_FILE="${ROOT_DIR}producer_lines.txt"
# PRODUCER_LINES_FILE="./producer_lines.txt"

ROTATIONS_FILE="${ROOT_DIR}rotations.txt"

: > "$ALERTS_FILE"
rm -f "$SUMMARY_FILE" "$TIMELINE_FILE" "$PRODUCER_LINES_FILE" "$ROTATIONS_FILE" *.pid

# --------------------------
# Helper function
# --------------------------
now_ms() { python3 -c "import time; print(int(time.time() * 1000))"; }

# --------------------------
# Start consumer first
# --------------------------
CONS_START=$(now_ms)
cat "$PIPE_DIR/events.fifo" | awk -f consumer.awk >> "$LOG_DIR/events.log" &
CONS_PID=$!

# Ensure consumer is ready
sleep 1

# --------------------------
# Start producer
# --------------------------
PROD_START=$(now_ms)
python3 producer.py > "$PIPE_DIR/events.fifo" &
PROD_PID=$!

echo "$PROD_PID" > "${ROOT_DIR}producer.pid"
echo "$CONS_PID" > "${ROOT_DIR}consumer.pid"

# --------------------------
# Cleanup
# --------------------------
cleanup(){
  kill -TERM "$CONS_PID" 2>/dev/null || true
  wait "$CONS_PID" 2>/dev/null || true
}
trap cleanup INT TERM

# --------------------------
# Run long enough for logs, alerts, overlap
# --------------------------
sleep 32

# Wait for producer to finish writing
wait "$PROD_PID"

# Then safely cleanup consumer
cleanup

PROD_END=$(now_ms)
CONS_END=$(now_ms)

# --------------------------
# Count rotations (non-empty)
# --------------------------
ROT=0
for f in "$LOG_DIR/events.log" "$LOG_DIR/events.log.1" "$LOG_DIR/events.log.2" "$LOG_DIR/events.log.3"; do
  [ -s "$f" ] && ROT=$((ROT+1))
done

# --------------------------
# Count producer lines & alerts
# --------------------------
PL=0; AL=0
[ -f "$PRODUCER_LINES_FILE" ] && PL=$(cat "$PRODUCER_LINES_FILE")
[ -f "$ALERTS_FILE" ] && AL=$(grep -c '^ALERT ' "$ALERTS_FILE" || true)


if [ -f "$PRODUCER_LINES_FILE" ]; then
    echo "Producer lines file exists:"
    cat "$PRODUCER_LINES_FILE"
else
    echo "Producer lines file NOT found!"
fi


# --------------------------
# Write summary JSON
# --------------------------
cat > "${ROOT_DIR}write_json.py" <<EOF
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
open("$SUMMARY_FILE","w").write(json.dumps(summary))
open("$TIMELINE_FILE","w").write(json.dumps(timeline))
EOF

python3 "${ROOT_DIR}write_json.py"

echo DONE
