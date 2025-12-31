# quick check script
from websockets.sync.server import serve
from websockets.sync.client import connect
import threading, time, socket
def echo(ws):
    for m in ws:
        ws.send(m)
port = 8765
srv = serve(echo, "127.0.0.1", port).__enter__()
t = threading.Thread(target=srv.serve_forever); t.start()
time.sleep(0.2)
with connect(f"ws://127.0.0.1:{port}", open_timeout=3.0) as c:
    c.send("hi"); print(c.recv())
srv.shutdown(); t.join()


import threading
import time
import uuid
import random
import pytest
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
    def __init__(self):
        self.logger = DummyLogger()
        self.id = uuid.uuid4()
        self.debug = False
        self._state = State.OPEN
        self.side = Side.CLIENT
        self.close_sent = None

    @property
    def state(self): return self._state
    @state.setter
    def state(self, value): self._state = value

    def close_expected(self) -> bool: return self._state is State.CLOSING

    @property
    def close_exc(self):
        if self.state is State.CLOSED:
            close_frame = Close(code=1000, reason="connection closed")
            return ConnectionClosedOK(close_frame, close_frame, True)
        return None

    def send_ping(self, data: bytes = None):
        import threading as _thr
        event = _thr.Event()
        # Simulate delayed pong acknowledgment
        def ack_later():
            time.sleep(random.uniform(0.00005, 0.001))
            event.set()
        threading.Thread(target=ack_later, daemon=True).start()
        return event

    def send_pong(self, data: bytes = None): return
    def send_close(self, code=None, reason=""):
        self.close_sent = code
        self.state = State.CLOSING
    def receive_eof(self): self.state = State.CLOSED

# --- Helpers ---------------------------------------------------------------

def make_connection():
    return Connection(DummySocket(), DummyProtocol())

def spam_pings(conn, n=10, interval=0.00005):
    """Call conn.ping() multiple times and return the Events."""
    events = []
    for _ in range(n):
        try:
            events.append(conn.ping())
        except ConnectionClosedOK:
            break
        time.sleep(interval)
    return events

# --- Tests with unacknowledged counter ------------------------------------

@pytest.mark.timeout(5)
def test_connection_closes_cleanly_dummy():
    conn = make_connection()
    waiters = []

    threads = [threading.Thread(target=lambda: waiters.extend(spam_pings(conn, 20)))
               for _ in range(4)]
    for t in threads: t.start()

    time.sleep(0.0005)
    try:
        conn.close()
    except ConnectionClosedOK:
        pass

    for t in threads: t.join(timeout=1)

    # Count unacknowledged ping events
    unack = sum(1 for e in waiters if not e.is_set())
    print(f"[Cleanly] Unacknowledged ping events: {unack}")

    for event in waiters:
        assert event.is_set(), "Ping Event should be acknowledged after close()"

@pytest.mark.timeout(5)
def test_close_multiple_times_safely_dummy():
    conn = make_connection()
    waiters = []

    threads = [threading.Thread(target=lambda: waiters.extend(spam_pings(conn, 15)))
               for _ in range(3)]
    for t in threads: t.start()

    time.sleep(0.0005)
    try:
        conn.close()
        conn.close()
        conn.close()
    except ConnectionClosedOK:
        pass

    for t in threads: t.join(timeout=1)

    unack = sum(1 for e in waiters if not e.is_set())
    print(f"[Multiple closes] Unacknowledged ping events: {unack}")

    for event in waiters:
        assert event.is_set(), "Ping Event should be acknowledged after multiple closes"

@pytest.mark.timeout(5)
def test_closure_with_concurrent_spammers_dummy():
    conn = make_connection()
    waiters = []

    threads = [threading.Thread(target=lambda: waiters.extend(spam_pings(conn, 20)))
               for _ in range(6)]
    for t in threads: t.start()

    time.sleep(0.0005)
    try:
        conn.close()
    except ConnectionClosedOK:
        pass

    for t in threads: t.join(timeout=1)

    unack = sum(1 for e in waiters if not e.is_set())
    print(f"[Concurrent spammers] Unacknowledged ping events: {unack}")

    for event in waiters:
        assert event.is_set(), "Ping Event should be acknowledged after concurrent spammers"



# import threading
# import time
# import uuid
# import pytest
# from websockets.sync.connection import Connection
# from websockets.protocol import State, Side
# from websockets.exceptions import ConnectionClosedOK
# from websockets.frames import Close




# class DummyLogger:
#     def debug(self, *a, **kw): pass
#     def info(self, *a, **kw): pass
#     def warning(self, *a, **kw): pass
#     def error(self, *a, **kw): pass
#     def exception(self, *a, **kw): pass
#     def isEnabledFor(self, level: int) -> bool:
#         return False


# class DummySocket:
#     def close(self): pass
#     def shutdown(self, how): pass


# class DummyProtocol:
#     def __init__(self):
#         self.id = uuid.uuid4()
#         self.logger = DummyLogger()
#         self.debug = False
#         self._state = State.OPEN
#         self.side = Side.CLIENT
#         self.close_sent = None

#     @property
#     def state(self):
#         return self._state

#     @state.setter
#     def state(self, value):
#         self._state = value

#     def close_expected(self) -> bool:
#         return self._state is State.CLOSING

#     @property
#     def close_exc(self):
#         if self.state is State.CLOSED:
#             close_frame = Close(code=1000, reason="connection closed")
#             return ConnectionClosedOK(close_frame, close_frame, True)
#         return None

#     def send_ping(self, data: bytes = None):
#         import threading as _thr
#         return _thr.Event()

#     def send_pong(self, data: bytes = None): return

#     def send_close(self, code=None, reason=""):
#         self.close_sent = code
#         self.state = State.CLOSING

#     def receive_eof(self):
#         self.state = State.CLOSED




# def make_connection():
#     """Create a Connection using dummy protocol and socket."""
#     return Connection(DummySocket(), DummyProtocol())

# def make_waiter_entry():
#     """Create a tuple like Connection.pong_waiters expects."""
#     return (threading.Event(), time.monotonic(), True)

# def spam_pings(conn, n=10, interval=0.0002):
#     """Add multiple pings deterministically."""
#     for _ in range(n):
#         key = f"spam-{uuid.uuid4().hex[:6]}"
#         conn.pong_waiters[key] = make_waiter_entry()
#         time.sleep(interval)



# @pytest.mark.timeout(5)
# def test_connection_closes_cleanly():
#     """Close a connection while spamming some pings; verify all waiters acknowledged."""
#     conn = make_connection()
#     conn.pong_waiters = {}

    
#     for i in range(3):
#         conn.pong_waiters[f"initial-{i}-{uuid.uuid4().hex[:6]}"] = make_waiter_entry()

 
#     t = threading.Thread(target=spam_pings, args=(conn, 20))
#     t.start()
#     time.sleep(0.001)  

#     try:
#         conn.close()  
#     finally:
#         t.join(timeout=1)


#     for waiter, _, ack in conn.pong_waiters.values():
#         if ack:
#             assert waiter.is_set(), "Pending ping waiter must be acknowledged after close()"


# @pytest.mark.timeout(5)
# def test_close_multiple_times_safely():
#     """Call close() multiple times rapidly; ensure all waiters are acknowledged."""
#     conn = make_connection()
#     conn.pong_waiters = {}

#     # Pre-populate
#     for i in range(3):
#         conn.pong_waiters[f"initial-{i}-{uuid.uuid4().hex[:6]}"] = make_waiter_entry()

#     t = threading.Thread(target=spam_pings, args=(conn, 10))
#     t.start()
#     time.sleep(0.001)

    
#     try:
#         conn.close()
#         conn.close()
#         conn.close()
#     finally:
#         t.join(timeout=1)

#     for waiter, _, ack in conn.pong_waiters.values():
#         if ack:
#             assert waiter.is_set(), "Pending ping waiter must be acknowledged after multiple closes"


# @pytest.mark.timeout(5)
# def test_closure_with_concurrent_spammers():
#     """Run multiple threads adding pings concurrently while closing connection."""
#     conn = make_connection()
#     conn.pong_waiters = {}

#     threads = [threading.Thread(target=spam_pings, args=(conn, 10, 0.0001)) for _ in range(4)]
#     for t in threads: t.start()
#     time.sleep(0.001)

#     try:
#         conn.close()  
#     finally:
#         for t in threads:
#             t.join(timeout=1)

#     for waiter, _, ack in conn.pong_waiters.values():
#         if ack:
#             assert waiter.is_set(), "Pending ping waiter must be acknowledged after concurrent spammers"

