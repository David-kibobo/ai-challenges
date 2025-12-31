import threading
import time
import sys

pong_waiters = {}

def modify_dict():
    for i in range(1000):
        pong_waiters[i] = (threading.Event(), time.monotonic(), True)
        # Force the scheduler to switch threads more often
        time.sleep(0)
        if i % 100 == 0:
            sys.stdout.write(".")
            sys.stdout.flush()

def iterate_dict():
    for _ in range(1000):
        try:
            # small artificial delay to widen the window for conflict
            time.sleep(0.00001)
            for val in pong_waiters.values():
                # yield mid-loop so modification can happen mid-iteration
                time.sleep(0)
        except RuntimeError as e:
            print("\n🔥 Race detected:", e)
            break

if __name__ == "__main__":
    t1 = threading.Thread(target=modify_dict)
    t2 = threading.Thread(target=iterate_dict)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
