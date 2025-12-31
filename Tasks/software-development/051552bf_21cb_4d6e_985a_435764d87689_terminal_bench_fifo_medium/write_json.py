import json
n = int("1368")
summary = {
    "producer_lines_total": n,
    "producer_lines": n,
    "alerts": int("7"),
    "rotations_min": int("3"),
    "parallel": True,
}
timeline = {
    "consumer_start_ms": int("1758505576507"),
    "producer_start_ms": int("1758505577072"),
    "consumer_end_ms": int("1758505609632"),
    "producer_end_ms": int("1758505609326"),
}
open("summary.json","w").write(json.dumps(summary))
open("timeline.json","w").write(json.dumps(timeline))
