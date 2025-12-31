import functools

import pytest
from tenacity import retry, stop_after_attempt, RetryError, wait_fixed


def outer_wrapper(fn):
    @functools.wraps(fn)
    def wrapped(*args, **kwargs):
        return fn(*args, **kwargs)
    if hasattr(fn, "retry"):
        wrapped.retry = getattr(fn, "retry")
    return wrapped


def simple_wrapper(fn):
    @functools.wraps(fn)
    def wrapped(*args, **kwargs):
        return fn(*args, **kwargs)
    return wrapped


def multi_wrapper(fn):
    @functools.wraps(fn)
    def inner(*args, **kwargs):
        return fn(*args, **kwargs)
    @functools.wraps(inner)
    def outer(*args, **kwargs):
        return inner(*args, **kwargs)
    if hasattr(fn, "retry"):
        outer.retry = getattr(fn, "retry")
    return outer


def _get_stats(callable_obj):
    obj = callable_obj
    while obj is not None:
        stats = getattr(obj, "statistics", None)
        if isinstance(stats, dict) and stats:
            return stats
        obj = getattr(obj, "__wrapped__", None)
    retry_obj = getattr(callable_obj, "retry", None)
    if retry_obj is None:
        inner = getattr(callable_obj, "__wrapped__", None)
        if inner is not None:
            retry_obj = getattr(inner, "retry", None)
    if retry_obj is not None:
        stats = getattr(retry_obj, "statistics", None)
        if isinstance(stats, dict) and stats:
            return stats
    return {}


def _get_retry_obj(callable_obj):
    obj = callable_obj
    while obj is not None:
        retry_obj = getattr(obj, "retry", None)
        if retry_obj is not None:
            return retry_obj
        obj = getattr(obj, "__wrapped__", None)
    return None


def _assert_nonempty_stats(stats, expected_attempts=None):
    assert isinstance(stats, dict), "statistics must be a dict"
    assert stats, "statistics is empty (no retry info recorded)"
    assert "attempt_number" in stats, "attempt_number must be present in statistics"
    if expected_attempts is not None:
        assert stats["attempt_number"] == expected_attempts, f"expected {expected_attempts} attempts, got {stats['attempt_number']}"


def _assert_outcome_reflected(stats, max_attempts, succeeded):
    assert "attempt_number" in stats, "attempt_number must be present to verify outcome"
    if succeeded:
        assert stats["attempt_number"] < max_attempts, "success case should have fewer attempts than max"
    else:
        assert stats["attempt_number"] == max_attempts, "failure case should have exhausted all attempts"


def test_statistics_base_case():
    @retry(stop=stop_after_attempt(3), reraise=False)
    def f():
        raise ValueError("fail intentionally")
    with pytest.raises(RetryError):
        f()
    stats = _get_stats(f)
    _assert_nonempty_stats(stats, expected_attempts=3)
    _assert_outcome_reflected(stats, max_attempts=3, succeeded=False)
    retry_obj = _get_retry_obj(f)
    assert retry_obj is not None, "retry object not found on decorated function"
    _assert_nonempty_stats(retry_obj.statistics, expected_attempts=3)
    assert retry_obj.statistics == stats


def test_statistics_wrapped_case():
    @outer_wrapper
    @retry(stop=stop_after_attempt(3), reraise=False)
    def f_wrapped():
        raise ValueError("fail intentionally")
    with pytest.raises(RetryError):
        f_wrapped()
    stats = _get_stats(f_wrapped)
    _assert_nonempty_stats(stats, expected_attempts=3)
    _assert_outcome_reflected(stats, max_attempts=3, succeeded=False)
    retry_obj = _get_retry_obj(f_wrapped)
    assert retry_obj is not None, "retry object not found on wrapped function"
    _assert_nonempty_stats(retry_obj.statistics, expected_attempts=3)
    assert retry_obj.statistics == stats


def test_statistics_success_case():
    call_count = {"n": 0}
    @retry(stop=stop_after_attempt(3), reraise=False)
    def f_success():
        call_count["n"] += 1
        if call_count["n"] < 2:
            raise ValueError("fail once")
        return "ok"
    result = f_success()
    assert result == "ok"
    stats = _get_stats(f_success)
    _assert_nonempty_stats(stats, expected_attempts=2)
    _assert_outcome_reflected(stats, max_attempts=3, succeeded=True)
    retry_obj = _get_retry_obj(f_success)
    assert retry_obj is not None, "retry object not found on success-case function"
    _assert_nonempty_stats(retry_obj.statistics, expected_attempts=2)
    assert retry_obj.statistics == stats


def test_statistics_simple_wrapper_case():
    @simple_wrapper
    @retry(stop=stop_after_attempt(2), reraise=False)
    def f_simple():
        raise ValueError("fail")
    with pytest.raises(RetryError):
        f_simple()
    stats = _get_stats(f_simple)
    _assert_nonempty_stats(stats, expected_attempts=2)
    _assert_outcome_reflected(stats, max_attempts=2, succeeded=False)
    retry_obj = _get_retry_obj(f_simple)
    assert retry_obj is not None, "retry object not found on simply wrapped function"
    _assert_nonempty_stats(retry_obj.statistics, expected_attempts=2)
    assert retry_obj.statistics == stats


def test_statistics_multi_wrapper_case():
    @multi_wrapper
    @retry(stop=stop_after_attempt(2), reraise=False)
    def f_multi():
        raise ValueError("fail")
    with pytest.raises(RetryError):
        f_multi()
    stats = _get_stats(f_multi)
    _assert_nonempty_stats(stats, expected_attempts=2)
    _assert_outcome_reflected(stats, max_attempts=2, succeeded=False)
    retry_obj = _get_retry_obj(f_multi)
    assert retry_obj is not None, "retry object not found on multi-wrapped function"
    _assert_nonempty_stats(retry_obj.statistics, expected_attempts=2)
    assert retry_obj.statistics == stats


def test_statistics_wrapped_success_case():
    call_count = {"n": 0}
    @outer_wrapper
    @retry(stop=stop_after_attempt(3), reraise=False)
    def f_wrapped_success():
        call_count["n"] += 1
        if call_count["n"] < 2:
            raise ValueError("fail once")
        return "success"
    result = f_wrapped_success()
    assert result == "success"
    stats = _get_stats(f_wrapped_success)
    _assert_nonempty_stats(stats, expected_attempts=2)
    _assert_outcome_reflected(stats, max_attempts=3, succeeded=True)
    retry_obj = _get_retry_obj(f_wrapped_success)
    assert retry_obj is not None, "retry object not found on wrapped success function"
    _assert_nonempty_stats(retry_obj.statistics, expected_attempts=2)
    assert retry_obj.statistics == stats


def test_statistics_with_wait_strategy():
    @outer_wrapper
    @retry(stop=stop_after_attempt(2), wait=wait_fixed(0.01), reraise=False)
    def f_with_wait():
        raise ValueError("fail")
    with pytest.raises(RetryError):
        f_with_wait()
    stats = _get_stats(f_with_wait)
    _assert_nonempty_stats(stats, expected_attempts=2)
    _assert_outcome_reflected(stats, max_attempts=2, succeeded=False)
    retry_obj = _get_retry_obj(f_with_wait)
    assert retry_obj is not None, "retry object not found on function with wait strategy"
    _assert_nonempty_stats(retry_obj.statistics, expected_attempts=2)
    assert retry_obj.statistics == stats


def test_statistics_direct_access():
    @outer_wrapper
    @retry(stop=stop_after_attempt(2), reraise=False)
    def f_direct():
        raise ValueError("fail")
    with pytest.raises(RetryError):
        f_direct()
    stats = _get_stats(f_direct)
    _assert_nonempty_stats(stats, expected_attempts=2)
    _assert_outcome_reflected(stats, max_attempts=2, succeeded=False)
    retry_obj = _get_retry_obj(f_direct)
    assert retry_obj is not None, "retry object not found on direct access function"
    _assert_nonempty_stats(retry_obj.statistics, expected_attempts=2)
    assert retry_obj.statistics == stats


def test_statistics_populated_after_call():
    @outer_wrapper
    @retry(stop=stop_after_attempt(2), reraise=False)
    def f():
        raise ValueError("fail")
    with pytest.raises(RetryError):
        f()
    stats = _get_stats(f)
    _assert_nonempty_stats(stats, expected_attempts=2)
    _assert_outcome_reflected(stats, max_attempts=2, succeeded=False)
    retry_obj = _get_retry_obj(f)
    assert retry_obj is not None
    _assert_nonempty_stats(retry_obj.statistics, expected_attempts=2)
    assert retry_obj.statistics == stats
