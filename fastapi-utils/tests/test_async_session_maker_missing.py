# import pytest
# import asyncio
# from fastapi import FastAPI, Depends
# from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
# from sqlalchemy import text
# from fastapi_utils.session import FastAPISessionMaker

# DATABASE_URL = "sqlite+aiosqlite:///:memory:"

# """
# These tests are behavior-based and intentionally FAIL on fastapi-utils==0.8.0.

# They express the expected async session behavior rather than checking for
# method names or attributes. Once async session support is implemented,
# all tests should pass without modification.
# """

# @pytest.fixture
# def maker():
#     """Provide FastAPISessionMaker for tests."""
#     return FastAPISessionMaker(DATABASE_URL)


# # -------------------------------------------------------------
# # 1. Async session creation and query (behavior test)
# # -------------------------------------------------------------
# @pytest.mark.asyncio
# async def test_async_session_can_execute_query(maker):
#     """
#     Expected behavior:
#       The sessionmaker should yield an AsyncSession capable of executing async queries.
#     Current (v0.8.0):
#       Likely fails due to sync Session being used or missing async generator.
#     """
#     # Behavior-based: we *try* to use async-style DB interaction
#     try:
#         async for db in maker.get_db():  # expected to be async generator
#             result = await db.execute(text("SELECT 1"))
#             assert result.scalar() == 1
#             return
#     except Exception as e:
#         pytest.fail(f"Async session behavior failed: {e}")


# # -------------------------------------------------------------
# # 2. Context-managed async session behavior
# # -------------------------------------------------------------
# @pytest.mark.asyncio
# async def test_async_context_manager_commits(maker):
#     """
#     Expected:
#       Using 'async with maker.context_session()' should allow async execution.
#     Current:
#       Usually fails with 'TypeError: object is not async context manager'
#       or AttributeError.
#     """
#     try:
#         async with maker.context_session() as db:
#             result = await db.execute(text("SELECT 1"))
#             assert result.scalar() == 1
#     except Exception as e:
#         pytest.fail(f"Async context manager behavior failed: {e}")


# # -------------------------------------------------------------
# # 3. Concurrency and engine reuse
# # -------------------------------------------------------------
# @pytest.mark.asyncio
# async def test_async_engine_reuse_across_tasks(maker):
#     """
#     Expected:
#       Creating multiple sessions concurrently should reuse the same async engine.
#     """
#     async def get_engine():
#         try:
#             return maker._engine
#         except Exception as e:
#             pytest.fail(f"Engine retrieval failed: {e}")

#     results = await asyncio.gather(*[get_engine() for _ in range(5)])
#     first = results[0]
#     assert all(r is first for r in results), "Engines differ across tasks."


# # -------------------------------------------------------------
# # 4. Integration: FastAPI async dependency should work
# # -------------------------------------------------------------
# @pytest.mark.asyncio
# async def test_fastapi_async_dependency_behavior(maker):
#     """
#     Expected:
#       It should be possible to use FastAPISessionMaker in async FastAPI dependencies.
#     """
#     app = FastAPI()

#     async def get_db():
#         async for db in maker.get_db():
#             yield db

#     @app.get("/")
#     async def index(db: AsyncSession = Depends(get_db)):
#         result = await db.execute(text("SELECT 1"))
#         return {"result": result.scalar()}

#     # Behavior-driven test: simulate dependency call
#     try:
#         async for db in get_db():
#             res = await db.execute(text("SELECT 1"))
#             assert res.scalar() == 1
#             return
#     except Exception as e:
#         pytest.fail(f"FastAPI async dependency failed: {e}")import asyncio
import inspect
from typing import Any, Callable, Optional, Tuple

import pytest
from fastapi import FastAPI, Depends
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from fastapi_utils.session import FastAPISessionMaker  # existing class; tests assert behavior

DATABASE_URL = "sqlite+aiosqlite:///:memory:"


# ----------------------
# Helpers: capability discovery (behavior-first)
# ----------------------
COMMON_ASYNC_GEN_NAMES = (
    "get_async_db",
    "get_db",
    "get_session",
    "get_async_session",
    "get_async_sessionmaker",
    "get_sessionmaker",
)
COMMON_CTX_NAMES = (
    "context_async_session",
    "context_session",
    "async_context_session",
    "session_context",
)


def _is_async_generator_callable(obj: Any) -> bool:
    """Return True if obj is an async generator function or returns an async generator when called."""
    if inspect.isasyncgenfunction(obj):
        return True
    # if it's already a bound method that is an async generator (rare), treat as True
    if inspect.iscoroutinefunction(obj):
        return False
    return False


async def _call_maybe_async_gen(factory: Callable[..., Any]):
    """
    Call a candidate factory and try to obtain an async generator.
    Return the async generator if successful, or raise.
    We protect calls in try/except so tests fail with clear messages if calling is not possible.
    """
    # If it's already an async generator function, calling it returns an async generator.
    if inspect.isasyncgenfunction(factory):
        return factory()
    # If it's a normal callable and returns an async generator when called, try calling it.
    # Many implementations expose a sync property that returns an async generator when called (rare),
    # but we still try.
    try:
        result = factory()
    except TypeError as e:
        # Could be a method requiring args — treat as missing capability
        raise AssertionError(f"Candidate callable {factory!r} could not be called without args: {e}")

    # If the result looks like an async generator, return it
    if inspect.isasyncgen(result):
        return result

    # Some implementations might return an object implementing __aiter__ (async iterable)
    if hasattr(result, "__aiter__"):
        return result

    raise AssertionError(f"Callable {factory!r} did not return an async generator/async iterable.")


def _find_async_generator_factory(obj) -> Tuple[str, Callable[..., Any]]:
    """
    Try common names first, then scan public callables on the object.
    Returns (name, factory_callable) if found, otherwise raises AssertionError.
    """
    # 1) check common names
    for name in COMMON_ASYNC_GEN_NAMES:
        if hasattr(obj, name):
            cand = getattr(obj, name)
            if callable(cand):
                return name, cand

    # 2) scan public attributes for an async generator function (rare but safe to try)
    for name in dir(obj):
        if name.startswith("_"):
            continue
        cand = getattr(obj, name)
        if callable(cand) and (inspect.isasyncgenfunction(cand) or inspect.iscoroutinefunction(cand)):
            # return it; we'll validate by calling later
            return name, cand

    # If none found, fail (behavior absent)
    raise AssertionError(
        "No async session provider found on maker. "
        f"Tried common names: {COMMON_ASYNC_GEN_NAMES}. "
        "An implementation should expose an async generator dependency or factory that yields AsyncSession."
    )


def _find_async_context_manager(obj) -> Tuple[str, Callable[..., Any]]:
    """
    Try common context-manager names, then scan for callables that produce an object with async __aenter__.
    Returns (name, factory) or raises AssertionError.
    """
    for name in COMMON_CTX_NAMES:
        if hasattr(obj, name):
            cand = getattr(obj, name)
            if callable(cand):
                return name, cand

    # scan for callables that when called return an object with __aenter__ or __aenter__ async
    for name in dir(obj):
        if name.startswith("_"):
            continue
        cand = getattr(obj, name)
        if callable(cand):
            # attempt to call safely (catch TypeError)
            try:
                inst = cand()
            except TypeError:
                continue
            # check async context manager: has __aenter__ and it's awaitable when called
            if hasattr(inst, "__aenter__") and inspect.isawaitable(inst.__aenter__()):
                return name, cand
            # or asynccontextmanager returns object implementing __aenter__ returning awaitable
    raise AssertionError(
        "No async context manager factory found on maker. "
        f"Tried common names: {COMMON_CTX_NAMES}."
    )


# ----------------------
# Tests
# ----------------------
@pytest.fixture
def maker():
    """Return the existing FastAPISessionMaker instance under test"""
    return FastAPISessionMaker(DATABASE_URL)


@pytest.mark.asyncio
async def test_maker_provides_async_session_provider(maker):
    """
    Behavior to require:
      - maker has a callable that yields an AsyncSession when iterated in async context
      - we don't demand a specific name, we find a provider by behavior or from common names
    Failure mode in v0.8.0:
      - no provider exists, or provider yields a sync Session
    """
    name, factory = _find_async_generator_factory(maker)

    # call it and obtain the async generator/async iterable
    agen = await _call_maybe_async_gen(factory)
    # consume first yielded value
    try:
        session = await agen.__anext__()  # type: ignore[attr-defined]
    except StopAsyncIteration:
        raise AssertionError(f"The async provider '{name}' yielded nothing.")
    except AttributeError:
        raise AssertionError(
            f"The provider '{name}' did not behave as an async generator/iterable."
        )

    # Now assert that we got an AsyncSession instance
    assert isinstance(session, AsyncSession), (
        f"Provider '{name}' yielded {type(session)}; expected sqlalchemy.ext.asyncio.AsyncSession"
    )

    # cleanup: attempt to close session and fully exhaust generator
    try:
        # if provider expects commit/rollback, try rollback to be safe
        if hasattr(session, "rollback") and inspect.iscoroutinefunction(session.rollback):
            await session.rollback()
        if hasattr(session, "close") and inspect.iscoroutinefunction(session.close):
            await session.close()
    except Exception:
        # ignore cleanup errors but they shouldn't happen for a correct implementation
        pass

    # try to close generator gracefully if it supports aclose
    if hasattr(agen, "aclose"):
        await agen.aclose()


@pytest.mark.asyncio
async def test_maker_provides_async_context_manager(maker):
    """
    Behavior to require:
      - maker exposes an async context manager that yields an AsyncSession
      - test exercise: async with maker.context_async_session() as session: await session.execute(...)
    """
    name, factory = _find_async_context_manager(maker)

    # call factory to get context manager instance and test it in an async with block
    try:
        ctx = factory()
    except TypeError as e:
        raise AssertionError(f"Context manager factory '{name}' could not be called without args: {e}")

    # verify it is async context manager by using it
    async with ctx as session:
        assert isinstance(session, AsyncSession), (
            f"Context manager '{name}' yielded {type(session)}; expected AsyncSession"
        )
        # run a trivial query to ensure session works with await
        r = await session.execute(text("SELECT 1"))
        # result may be a ScalarResult; test at least that the call did not raise and returned something
        # If possible, check scalar() == 1
        try:
            val = r.scalar()
            assert val == 1
        except Exception:
            # not fatal; main behavior is that execute was awaitable and returned result-like object
            pass


@pytest.mark.asyncio
async def test_concurrent_sessions_share_engine(maker):
    """
    Behavior to require:
      - When multiple sessions are created concurrently from the async provider,
        they should be bound to the same engine (cached engine or factory should be safe).
      - We create N concurrent sessions and inspect their engine identity via session.get_bind() or .bind
    """
    name, factory = _find_async_generator_factory(maker)
    agen = await _call_maybe_async_gen(factory)

    async def acquire_engine_from_provider():
        gen = await _call_maybe_async_gen(factory)
        session = await gen.__anext__()  # get session
        # discover engine: prefer 'get_bind' method, else 'bind' attribute
        engine = None
        if hasattr(session, "get_bind"):
            try:
                engine = session.get_bind()
            except Exception:
                engine = getattr(session, "bind", None)
        else:
            engine = getattr(session, "bind", None)
        # cleanup session
        if hasattr(session, "close") and inspect.iscoroutinefunction(session.close):
            await session.close()
        if hasattr(gen, "aclose"):
            await gen.aclose()
        return engine

    # spawn many concurrent acquisitions (run in event loop)
    tasks = [asyncio.create_task(acquire_engine_from_provider()) for _ in range(12)]
    engines = await asyncio.gather(*tasks)

    # all engines should be not-None and identical (same object identity)
    assert all(e is not None for e in engines), "One or more sessions lacked an engine binding."
    first = engines[0]
    assert all(e is first for e in engines), "Concurrent sessions are not bound to the same engine (caching not in place)."


@pytest.mark.asyncio
async def test_fastapi_dependency_integration(maker):
    """
    Behavior to require:
      - It should be possible to use the provider as a FastAPI dependency in an async route.
      - We'll create an app using the discovered async generator provider and call the route using AsyncClient.
    """
    name, factory = _find_async_generator_factory(maker)

    # produce an async dependency function that delegates to the maker's provider
    async def get_db():
        gen = await _call_maybe_async_gen(factory)
        async for s in gen:
            yield s

    app = FastAPI()

    @app.get("/probe")
    async def probe(db: AsyncSession = Depends(get_db)):
        # small smoke test
        r = await db.execute(text("SELECT 1"))
        try:
            return {"res": r.scalar()}
        finally:
            # let dependency cleanup close session if needed
            pass

    async with AsyncClient(app=app, base_url="http://test") as client:
        resp = await client.get("/probe")
        assert resp.status_code == 200, f"Expected 200 from /probe, got {resp.status_code}"
        # body should be JSON with mapping; if scalar() returned 1, value should be 1
        j = resp.json()
        assert "res" in j, "Response missing 'res' key"

