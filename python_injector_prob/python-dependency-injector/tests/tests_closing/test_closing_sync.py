import pytest
from dependency_injector import containers, providers
from dependency_injector.wiring import inject, Provide, Closing

created_sessions = []

class MockSession:
    def __init__(self):
        self.committed = False
        self.rolled_back = False
        self.closed = False
        self.order = [] 

    def commit(self):
        self.committed = True
        self.order.append("commit")

    def rollback(self):
        self.rolled_back = True
        self.order.append("rollback")

    def close(self):
        self.closed = True
        self.order.append("close")


def init_session():
    s = MockSession()
    created_sessions.append(s)
    try:
        yield s
    finally:
        s.close()


class Container(containers.DeclarativeContainer):
    session = providers.Resource(init_session)


@inject
def handler(session: MockSession = Closing[Provide[Container.session]]):
  
    _ = session  
    return "ok"


@inject
def handler_error(session: MockSession = Closing[Provide[Container.session]]):
   
    raise RuntimeError("boom")


def test_commit_on_success():
    created_sessions.clear()
    container = Container()
    container.wire(modules=[__name__])

    handler()
    s = created_sessions.pop()

  
    assert s.committed is True
    assert s.rolled_back is False
    assert s.closed is True

  
    assert s.order == ["commit", "close"], f"Expected commit before close, got {s.order}"


def test_rollback_on_exception():
    created_sessions.clear()
    container = Container()
    container.wire(modules=[__name__])

    with pytest.raises(RuntimeError):
        handler_error()
    s = created_sessions.pop()

   
    assert s.committed is False
    assert s.rolled_back is True
    assert s.closed is True

  
    assert s.order == ["rollback", "close"], f"Expected rollback before close, got {s.order}"
