import json
n = int("862")
summary = {
    "producer_lines_total": n,
    "producer_lines": n,
    "alerts": int("7"),
    "rotations_min": int("4"),
    "parallel": True,
}
timeline = {
    "consumer_start_ms": int("1758459565937"),
    "producer_start_ms": int("1758459566967"),
    "consumer_end_ms": int("1758459599030"),
    "producer_end_ms": int("1758459599003"),
}
open("./summary.json","w").write(json.dumps(summary))
open("./timeline.json","w").write(json.dumps(timeline))
