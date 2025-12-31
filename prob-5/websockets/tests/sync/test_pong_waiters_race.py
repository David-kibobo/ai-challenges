import threading
import time
import pytest
import uuid
from websockets.sync.connection import Connection, ConnectionClosedOK
from websockets.protocol import State, Side
from websockets.frames import Close

# --- Dummy helpers -----------------------------------------------------------

class DummyLogger:
    def debug(self, *a, **kw): pass
    def info(self, *a, **kw): pass
    def warning(self, *a, **kw): pass
    def error(self, *a, **kw): pass
    def exception(self, *a, **kw): pass
    def isEnabledFor(self, level: int) -> bool: return False

class DummySocket:
    def close(self): pass
    def shutdown(self, how): pass

class DummyProtocol:
    """Minimal protocol that supports public API without touching internals."""
    def __init__(self, ping_delay=0.008):
        self.id = uuid.uuid4()
        self.logger = DummyLogger()
        self.debug = False
        self._state = State.OPEN
        self.side = Side.CLIENT
        self.close_sent = None
        self.ping_delay = ping_delay  # configurable delay to simulate race

    @property
    def state(self): return self._state
    @state.setter
    def state(self, value): self._state = value

    def close_expected(self) -> bool: return self._state is State.CLOSING

    @property
    def close_exc(self):
        if self._state == State.CLOSED:
            close_frame = Close(code=1000, reason="connection closed")
            return ConnectionClosedOK(close_frame, close_frame, True)
        return None

    def send_ping(self, data=None):
        """Return an Event but do NOT set it immediately to simulate delayed acknowledgment."""
        event = threading.Event()
        def ack_later():
            time.sleep(self.ping_delay)  # configurable
            event.set()
        threading.Thread(target=ack_later).start()
        return event

    def send_close(self, code=None, reason=""):
        self.close_sent = code
        self._state = State.CLOSING

    def receive_eof(self):
        self._state = State.CLOSED

# --- Helpers ---------------------------------------------------------------

def make_connection(ping_delay=0.008):
    return Connection(DummySocket(), DummyProtocol(ping_delay=ping_delay))

def spam_pings(conn, n=10, interval=0.0001):
    """Call conn.ping() multiple times and return the Events."""
    events = []
    for _ in range(n):
        try:
            event = conn.ping()
            events.append(event)
        except ConnectionClosedOK:
            break
        time.sleep(interval)
    return events

# --- Configurable test parameters -----------------------------------------

NUM_THREADS = 10
NUM_PINGS = 20
PING_INTERVAL = 0.00005
PING_DELAY = 0.05      # increase to make race more likely
PRE_CLOSE_SLEEP = 0.0001

# --- Tests -----------------------------------------------------------------

@pytest.mark.timeout(5)
def test_connection_closes_cleanly_behavior():
    conn = make_connection(ping_delay=PING_DELAY)
    waiters = []

    threads = [threading.Thread(target=lambda: waiters.extend(spam_pings(conn, NUM_PINGS, PING_INTERVAL)))
               for _ in range(NUM_THREADS)]
    for t in threads: t.start()

    time.sleep(PRE_CLOSE_SLEEP)
    try:
        conn.close()
    except ConnectionClosedOK:
        pass

    for t in threads: t.join(timeout=1)

    for event in waiters:
        assert event.is_set(), "Ping Event should be acknowledged after close()"

@pytest.mark.timeout(5)
def test_close_multiple_times_safely_behavior():
    conn = make_connection(ping_delay=PING_DELAY)
    waiters = []

    threads = [threading.Thread(target=lambda: waiters.extend(spam_pings(conn, NUM_PINGS, PING_INTERVAL)))
               for _ in range(NUM_THREADS)]
    for t in threads: t.start()

    time.sleep(PRE_CLOSE_SLEEP)
    try:
        conn.close()
        conn.close()
        conn.close()
    except ConnectionClosedOK:
        pass

    for t in threads: t.join(timeout=1)

    for event in waiters:
        assert event.is_set(), "Ping Event should be acknowledged after multiple closes"

@pytest.mark.timeout(5)
def test_closure_with_concurrent_spammers_behavior():
    conn = make_connection(ping_delay=PING_DELAY)
    waiters = []

    threads = [threading.Thread(target=lambda: waiters.extend(spam_pings(conn, NUM_PINGS, PING_INTERVAL)))
               for _ in range(NUM_THREADS + 2)]  # more threads to increase contention
    for t in threads: t.start()

    time.sleep(PRE_CLOSE_SLEEP)
    try:
        conn.close()
    except ConnectionClosedOK:
        pass

    for t in threads: t.join(timeout=1)

    for event in waiters:
        assert event.is_set(), "Ping Event should be acknowledged after concurrent spammers"
