import json, time, random, string, pathlib, signal

LOG_DIR = pathlib.Path("logs")
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG = LOG_DIR / "events.log"

rnd = random.Random(1337)
USERS = ["alice", "bob", "carl", "dídí", "赵钱孙", "ユーザ", "🙂user"]

stop = False
def _term(sig, frame):
    global stop
    stop = True
signal.signal(signal.SIGTERM, _term)

def now_ms(): return int(time.time() * 1000)
def new_session():
    return ''.join(rnd.choice('abcdef0123456789') for _ in range(12))

def emit_line():
    # ~10% malformed lines
    if rnd.random() < 0.10:
        return '{bad json line"'
    t = now_ms()
    user = rnd.choice(USERS)
    admin = rnd.random() < 0.5  # generous to ensure alerts
    sess  = new_session()
    # long-ish payload to grow logs fast (helps size/rotation tests)
    payload = ''.join(rnd.choice(string.ascii_letters + " äöüß😀") for _ in range(rnd.randint(100, 180)))
    return json.dumps(
        {"ts": t, "session": sess, "user": user, "meta": {"admin": admin}, "payload": payload},
        ensure_ascii=False
    )

def rot():
    # size-based rotation at ~6 KiB: .1, .2, .3
    if LOG.exists() and LOG.stat().st_size >= 6 * 1024:
        p1 = LOG.with_suffix(".log.1")
        p2 = LOG.with_suffix(".log.2")
        p3 = LOG.with_suffix(".log.3")
        if p3.exists(): p3.unlink()
        if p2.exists(): p2.rename(p3)
        if p1.exists(): p1.rename(p2)
        LOG.rename(p1)

count = 0
start = time.time()
# Finish naturally before supervisor cleanup (supervisor sleeps ~32s)
MAX = 25.0
try:
    while not stop and (time.time() - start) < MAX:
        line = emit_line()
        # STDOUT → FIFO (supervisor redirects)
        print(line, flush=True)
        # Append to file log
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        rot()
        count += 1  # count ALL emitted lines (valid + malformed)
        # Pace chosen to satisfy volume ≥1100 within ~32 s total
        time.sleep(rnd.uniform(0.025, 0.030))
finally:
    # Always write the counter, even on SIGTERM
    with open("producer_lines.txt", "w") as f:
        f.write(str(count))
