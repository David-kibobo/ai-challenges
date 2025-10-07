### Configuration File Parser for an Advertising-Screen Service

**Background**
An advertising company deploys lightweight display players on remote screens. Each screen is configured at install time using a plain text configuration file. Field values in the config control runtime behavior (which data file to use, whether to re-read the file on every query, whether SSL is enabled, payload limits, etc.). Operators edit these files manually and they may contain comments, irrelevant lines, duplicated keys, or inconsistent whitespace. A robust parser is required so the player can validate configuration before starting and avoid crashes or silent misbehavior.

**Goal**
Implement a configuration loader that reads a plain text config file and returns a typed dictionary with validated values, or raises descriptive errors on invalid or missing required fields.

**Task**
Write a function with signature:

```python
parse_config(path: str) -> dict
```

The function must:
1. Read the text file located at `path`.
2. Extract exactly the following keys (case-sensitive exact names):
   - linuxpath        (string)   — required
   - REREAD_ON_QUERY  (boolean)  — required; must be "True" or "False"
   - SSL_ENABLED      (boolean)  — required; must be "True" or "False"
   - MAX_PAYLOAD      (integer)  — optional; if absent, return value `None`
3. Ignore all other lines.
4. Treat lines starting with `#` (after optional leading whitespace) as comments and ignore them.
5. Accept lines in the form `key=value`. Strip leading/trailing whitespace around both key and value.
6. If a key appears multiple times, the **last occurrence wins**.
7. If a required key is missing, raise a `ValueError` with a clear message like: `"Missing required field: linuxpath"`.
8. If a boolean key has an invalid value, raise a `ValueError` with a clear message like: `"Invalid boolean value for REREAD_ON_QUERY: YES"`.
9. If `MAX_PAYLOAD` is present but not a valid integer, raise a `ValueError` describing the problem.
10. Be resilient to large files (up to ~100,000 lines) — implement reading in a streaming/line-by-line manner rather than loading unnecessary extra data into memory.

**Input Format**
A plain text file containing many lines. Relevant lines use the `key=value` format. Example:

```conf
# Example config file (server.conf)
# main configuration
linuxpath=/var/lib/ads/200k.txt
REREAD_ON_QUERY=True

# security options
SSL_ENABLED=False
MAX_PAYLOAD=2048
```

**Output**
Return a Python dictionary with these keys and typed values, for example:

```python
{
  "linuxpath": "/var/lib/ads/200k.txt",
  "REREAD_ON_QUERY": True,
  "SSL_ENABLED": False,
  "MAX_PAYLOAD": 2048
}
```

**Constraints**
- Python version: 3.11.12
- Allowed libraries: standard library only (no external parsing libraries)
- Keys are case-sensitive and must match exactly.
- Boolean textual values must be exactly "True" or "False" (capital T / F).
- `MAX_PAYLOAD` is optional; if missing, the returned value must be `None`.

**Public Tests (visible to candidate)**
1) Basic parse:
   - Input file:
     ```conf
     linuxpath=/opt/service
     REREAD_ON_QUERY=True
     SSL_ENABLED=True
     MAX_PAYLOAD=4096
     ```
   - Expected return:
     ```python
     {
       "linuxpath": "/opt/service",
       "REREAD_ON_QUERY": True,
       "SSL_ENABLED": True,
       "MAX_PAYLOAD": 4096
     }
     ```

2) Optional MAX_PAYLOAD missing:
   - Input file:
     ```conf
     linuxpath=/data
     REREAD_ON_QUERY=False
     SSL_ENABLED=True
     ```
   - Expected return:
     ```python
     {
       "linuxpath": "/data",
       "REREAD_ON_QUERY": False,
       "SSL_ENABLED": True,
       "MAX_PAYLOAD": None
     }
     ```

3) Comments and whitespace:
   - Input file:
     ```conf
     # comment line
       linuxpath =   /tmp/data.txt
     REREAD_ON_QUERY = True
     SSL_ENABLED=False
     ```
   - Expected: whitespace trimmed and parsed as usual.

**Behavior on Errors (examples)**
- If linuxpath is missing → raise `ValueError("Missing required field: linuxpath")`
- If `REREAD_ON_QUERY=YES` → raise `ValueError("Invalid boolean value for REREAD_ON_QUERY: YES")`
- If `MAX_PAYLOAD=two_k` → raise `ValueError("Invalid integer value for MAX_PAYLOAD: two_k")`

**Hidden Tests (kept private)**
- Duplicate keys: last occurrence should win.
- Massive file (50k+ lines) with target keys near the end — parser should remain efficient.
- Keys with quoted values: `linuxpath="/path/with spaces"` (parser should accept and strip surrounding quotes).
- Lines with mixed-case keys (should not match; keys are case-sensitive).
- Extra unrelated lines and malformed lines (parser must ignore them safely).

**Deliverables**
- A Python module `config_parser.py` implementing `parse_config(path: str) -> dict`.
- Unit tests (pytest) covering the public tests in `tests/test_config_parser.py`.
- Clear and concise docstring for the function explaining behavior and exceptions.

**Notes**
This parser will be used as the first-stage configuration check for a screen player service run by an advertising company. It must be simple, robust, and predictable — operators will edit these files manually, so clear error messages are necessary to speed up debugging.
