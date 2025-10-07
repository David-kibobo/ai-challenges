from __future__ import annotations

from typing import Dict, Optional


def _strip_optional_quotes(value: str) -> str:
    """Strip a single pair of matching leading/trailing quotes if present.

    Accepts values like '"/path with spaces"' or "'/path'" and returns the inner text.
    If quotes are mismatched or only one side is quoted, leaves the value as-is.
    """
    if len(value) >= 2 and ((value[0] == value[-1]) and value[0] in {'"', "'"}):
        return value[1:-1]
    return value


def parse_config(path: str) -> Dict[str, object]:
    """Parse a plain text configuration file into a validated dictionary.

    Behavior:
    - Reads the file line-by-line (streaming) for efficiency on large files.
    - Recognizes only exact keys: 'linuxpath', 'REREAD_ON_QUERY', 'SSL_ENABLED', 'MAX_PAYLOAD'.
    - Lines starting with '#' (after optional leading whitespace) are comments and ignored.
    - Accepts lines of the form 'key=value'; trims whitespace around key and value.
    - If the same key appears multiple times, the last occurrence wins.
    - Required keys: 'linuxpath', 'REREAD_ON_QUERY', 'SSL_ENABLED'. Missing any raises ValueError.
    - Boolean keys must be exactly 'True' or 'False' (case-sensitive). Otherwise raise ValueError.
    - 'MAX_PAYLOAD' is optional; if absent, returns None. If present, must be a valid integer or raises ValueError.
    - Values may be optionally wrapped in matching single or double quotes; quotes are stripped.

    Args:
        path: Filesystem path to the configuration file.

    Returns:
        A dictionary with keys: 'linuxpath', 'REREAD_ON_QUERY', 'SSL_ENABLED', 'MAX_PAYLOAD'.

    Raises:
        ValueError: On missing required fields or invalid value formats.
        OSError: If the file cannot be opened/read.
    """
    # We collect raw values first (as strings) so that last occurrence wins before validation
    raw_values: Dict[str, str] = {}

    valid_keys = {"linuxpath", "REREAD_ON_QUERY", "SSL_ENABLED", "MAX_PAYLOAD"}

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            # Fast-path ignore for empty or whitespace-only lines
            if not line.strip():
                continue
            # Ignore comments after leading whitespace
            stripped_leading = line.lstrip()
            if stripped_leading.startswith('#'):
                continue
            # Expect key=value; ignore malformed lines quietly
            if '=' not in line:
                continue
            key_part, value_part = line.split('=', 1)
            key = key_part.strip()
            value = value_part.strip()

            if key not in valid_keys:
                # Ignore unrelated keys
                continue

            # Strip optional surrounding quotes from the value
            value = _strip_optional_quotes(value)

            raw_values[key] = value

    # Validate required fields
    for required_key in ("linuxpath", "REREAD_ON_QUERY", "SSL_ENABLED"):
        if required_key not in raw_values:
            raise ValueError(f"Missing required field: {required_key}")

    # Parse booleans with exact matching
    def parse_bool(field: str, text: str) -> bool:
        if text == "True":
            return True
        if text == "False":
            return False
        raise ValueError(f"Invalid boolean value for {field}: {text}")

    reread_on_query = parse_bool("REREAD_ON_QUERY", raw_values["REREAD_ON_QUERY"]) if "REREAD_ON_QUERY" in raw_values else None
    ssl_enabled = parse_bool("SSL_ENABLED", raw_values["SSL_ENABLED"]) if "SSL_ENABLED" in raw_values else None

    # Parse MAX_PAYLOAD if provided; else None
    max_payload: Optional[int]
    if "MAX_PAYLOAD" in raw_values:
        text = raw_values["MAX_PAYLOAD"]
        try:
            # Allow leading/trailing whitespace already trimmed; base 10 integer only
            max_payload = int(text)
        except Exception:
            raise ValueError(f"Invalid integer value for MAX_PAYLOAD: {text}")
    else:
        max_payload = None

    result: Dict[str, object] = {
        "linuxpath": raw_values["linuxpath"],
        "REREAD_ON_QUERY": reread_on_query,
        "SSL_ENABLED": ssl_enabled,
        "MAX_PAYLOAD": max_payload,
    }

    return result
