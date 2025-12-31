import pytest
from dependency_injector import containers, providers
from dependency_injector.wiring import inject, Provide, Closing

created_async_sessions = []

class MockSession:
    def __init__(self):
        self.committed = False
        self.rolled_back = False
        self.closed = False
        self.order = []  

    async def commit(self):
        self.committed = True
        self.order.append("commit")

    async def rollback(self):
        self.rolled_back = True
        self.order.append("rollback")

    async def close(self):
        self.closed = True
        self.order.append("close")


async def init_session_async():
    s = MockSession()
    created_async_sessions.append(s)
    try:
        yield s
    finally:
        await s.close()


class AsyncContainer(containers.DeclarativeContainer):
    async_session = providers.Resource(init_session_async)


@inject
async def async_handler(session: MockSession = Closing[Provide[AsyncContainer.async_session]]):
    
    _ = session
    return "ok"


@inject
async def async_handler_error(session: MockSession = Closing[Provide[AsyncContainer.async_session]]):
   
    raise RuntimeError("boom")


@pytest.mark.asyncio
async def test_async_commit_on_success():
    created_async_sessions.clear()
    container = AsyncContainer()
    container.wire(modules=[__name__])

    await async_handler()
    s = created_async_sessions.pop()

    assert s.committed is True
    assert s.rolled_back is False
    assert s.closed is True

   
    assert s.order == ["commit", "close"], f"Expected commit before close, got {s.order}"


@pytest.mark.asyncio
async def test_async_rollback_on_exception():
    created_async_sessions.clear()
    container = AsyncContainer()
    container.wire(modules=[__name__])

    with pytest.raises(RuntimeError):
        await async_handler_error()
    s = created_async_sessions.pop()

  
    assert s.committed is False
    assert s.rolled_back is True
    assert s.closed is True

    assert s.order == ["rollback", "close"], f"Expected rollback before close, got {s.order}"
