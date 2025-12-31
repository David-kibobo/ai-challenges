import json
n = int("1350")
summary = {
    "producer_lines_total": n,
    "producer_lines": n,
    "alerts": int("7"),
    "rotations_min": int("3"),
    "parallel": True,
}
timeline = {
    "consumer_start_ms": int("1758503478409"),
    "producer_start_ms": int("1758503478977"),
    "consumer_end_ms": int("1758503511798"),
    "producer_end_ms": int("1758503511507"),
}
open("summary.json","w").write(json.dumps(summary))
open("timeline.json","w").write(json.dumps(timeline))
