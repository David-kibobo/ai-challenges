"""Wiring optimizations module."""

from asyncio import gather
from collections.abc import Awaitable
from inspect import CO_ITERABLE_COROUTINE
from types import CoroutineType, GeneratorType
from .providers cimport Provider, Resource
from .wiring import _Marker


cdef inline bint _is_injectable(dict kwargs, object name):
    return name not in kwargs or isinstance(kwargs[name], _Marker)


cdef class DependencyResolver:
    cdef dict kwargs
    cdef dict to_inject
    cdef dict injections
    cdef dict closings

    def __init__(self, dict kwargs, dict injections, dict closings, /):
        self.kwargs = kwargs
        self.to_inject = kwargs.copy()
        self.injections = injections
        self.closings = closings

    async def _await_injection(self, name: str, value: object, /) -> None:
        self.to_inject[name] = await value

    cdef void _handle_injections_sync(self):
        cdef Provider provider
        for name, provider in self.injections.items():
            if _is_injectable(self.kwargs, name):
                self.to_inject[name] = provider()

    cdef list _handle_injections_async(self):
        cdef list to_await = []
        cdef Provider provider
        for name, provider in self.injections.items():
            if _is_injectable(self.kwargs, name):
                provide = provider()
                if provider.is_async_mode_enabled() or _isawaitable(provide):
                    to_await.append(self._await_injection(name, provide))
                else:
                    self.to_inject[name] = provide
        return to_await

    cdef void _handle_closings_sync(self, bint success):
        cdef Provider provider
        cdef object resource
        cdef Exception commit_err = None

        for name, provider in self.closings.items():
            if not (_is_injectable(self.kwargs, name) and isinstance(provider, Resource)):
                continue

            resource = self.to_inject.get(name, None)

            if resource is not None:
                if success and hasattr(resource, "commit"):
                    try:
                        resource.commit()
                    except Exception as e:
                        if commit_err is None:
                            commit_err = e
                elif not success and hasattr(resource, "rollback"):
                    try:
                        resource.rollback()
                    except Exception as e:
                        try:
                            print("DependencyResolver: rollback() raised:", e)
                        except Exception:
                            pass

            try:
                provider.shutdown()
            except Exception as e:
                if commit_err is not None:
                    raise commit_err
                raise e

        if commit_err is not None:
            raise commit_err

    cdef list _handle_closings_async(self, bint success):
        cdef list commit_awaitables = []
        cdef list shutdown_wrappers = []
        cdef Provider provider
        cdef object resource
        cdef object maybe
        cdef Exception commit_err = None

        for name, provider in self.closings.items():
            if not (_is_injectable(self.kwargs, name) and isinstance(provider, Resource)):
                continue

            resource = self.to_inject.get(name, None)
            if resource is not None:
                if success and hasattr(resource, "commit"):
                    try:
                        maybe = resource.commit()
                        if _isawaitable(maybe):
                            commit_awaitables.append(maybe)
                    except Exception as e:
                        if commit_err is None:
                            commit_err = e
                elif not success and hasattr(resource, "rollback"):
                    try:
                        maybe = resource.rollback()
                        if _isawaitable(maybe):
                            commit_awaitables.append(maybe)
                    except Exception as e:
                        try:
                            print("DependencyResolver: rollback() raised:", e)
                        except Exception:
                            pass

            def _make_wrapper(p):
                def _wrapper():
                    return p.shutdown()
                return _wrapper

            shutdown_wrappers.append(_make_wrapper(provider))

        async def _run_all():
            if commit_awaitables:
                await gather(*commit_awaitables)

            cdef list shutdown_awaitables = []
            for wrapper in shutdown_wrappers:
                try:
                    res = wrapper()
                except Exception as e:
                    if commit_err is not None:
                        raise commit_err
                    raise e

                if _isawaitable(res):
                    shutdown_awaitables.append(res)

            if shutdown_awaitables:
                try:
                    await gather(*shutdown_awaitables)
                except Exception as e:
                    if commit_err is not None:
                        raise commit_err
                    raise e

            if commit_err is not None:
                raise commit_err

        return [_run_all()]

    def __enter__(self):
        self._handle_injections_sync()
        return self.to_inject

    def __exit__(self, exc_type=None, exc=None, tb=None):
        success = exc_type is None
        self._handle_closings_sync(success)

    async def __aenter__(self):
        if to_await := self._handle_injections_async():
            await gather(*to_await)
        return self.to_inject

    async def __aexit__(self, exc_type=None, exc=None, tb=None):
        success = exc_type is None
        if to_await := self._handle_closings_async(success):
            await gather(*to_await)


cdef bint _isawaitable(object instance):
    """Return true if object can be passed to an ``await`` expression."""
    return (
        isinstance(instance, CoroutineType)
        or (isinstance(instance, GeneratorType) and bool(instance.gi_code.co_flags & CO_ITERABLE_COROUTINE))
        or isinstance(instance, Awaitable)
    )
