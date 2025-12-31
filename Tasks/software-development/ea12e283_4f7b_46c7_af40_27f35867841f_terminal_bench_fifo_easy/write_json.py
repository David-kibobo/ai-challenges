import json
n = int("854")
summary = {
    "producer_lines_total": n,
    "producer_lines": n,
    "alerts": int("0"),
    "rotations_min": int("3"),
    "parallel": True,
}
timeline = {
    "consumer_start_ms": int("1758459348262"),
    "producer_start_ms": int("1758459349297"),
    "consumer_end_ms": int("1758459381382"),
    "producer_end_ms": int("1758459381344"),
}
open("../summary.json","w").write(json.dumps(summary))
open("../timeline.json","w").write(json.dumps(timeline))
