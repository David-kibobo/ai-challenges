# tests/test_missing_sessions.py
import uuid
from datetime import datetime, timezone
from typing import Optional, Any
import dataclasses
import pytest
import pytest_asyncio
from fastapi import FastAPI, APIRouter
from httpx import AsyncClient, ASGITransport
from fastapi_users import FastAPIUsers
from fastapi_users.authentication import AuthenticationBackend, BearerTransport, JWTStrategy
from fastapi_users.manager import BaseUserManager
from fastapi_users.authentication.strategy import AccessTokenProtocol
from pydantic import BaseModel, EmailStr, Field


# ---------------- Minimal SessionModel used by tests ----------------
@dataclasses.dataclass
class SessionModel(AccessTokenProtocol[str]):
    token: str
    user_id: uuid.UUID
    id: uuid.UUID
    created_at: datetime

    @classmethod
    def make(cls, token: str, user_id: uuid.UUID):
        return cls(token=token, user_id=user_id, id=uuid.uuid4(), created_at=datetime.now(timezone.utc))


# ---------------- In-memory session DB ----------------
class InMemorySessionDB:
    """Simple in-memory session DB that mimics persistence for tests."""
    def __init__(self):
        self._by_id: dict[uuid.UUID, SessionModel] = {}
        self._by_token: dict[str, SessionModel] = {}

    async def create(self, session_dict: dict[str, Any]) -> SessionModel:
        token = session_dict.get("token") or str(uuid.uuid4())
        user_id = session_dict["user_id"]
        sess_id = session_dict.get("id", uuid.uuid4())
        s = SessionModel(
            token=token,
            user_id=user_id,
            id=sess_id,
            created_at=session_dict.get("created_at", datetime.now(timezone.utc)),
        )
        self._by_id[s.id] = s
        self._by_token[s.token] = s
        return s

    async def get_by_token(self, token: str) -> Optional[SessionModel]:
        return self._by_token.get(token)

    async def list_for_user(self, user_id: uuid.UUID) -> list[SessionModel]:
        return [s for s in self._by_id.values() if s.user_id == user_id]

    async def delete_by_id(self, session_id: uuid.UUID) -> None:
        s = self._by_id.pop(session_id, None)
        if s:
            self._by_token.pop(s.token, None)

    async def delete_all_for_user(self, user_id: uuid.UUID) -> None:
        for s in list(self._by_id.values()):
            if s.user_id == user_id:
                await self.delete_by_id(s.id)


# ---------------- Dummy User and Manager ----------------
class DummyUser(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    email: EmailStr = "test@example.com"
    hashed_password: str = "fake"
    is_active: bool = True
    is_verified: bool = True
    is_superuser: bool = False


class DummyUserManager(BaseUserManager[DummyUser, uuid.UUID]):
    def __init__(self, user_db=None):
        super().__init__(user_db)
        self.user_db = user_db

    async def get(self, id):
        return DummyUser(id=id, email=f"user-{id}@example.com")


# ---------------- Fixtures ----------------
@pytest.fixture
def auth_backend() -> AuthenticationBackend:
    bearer = BearerTransport(tokenUrl="/auth/jwt/login")

    def get_strategy():
        return JWTStrategy(secret="TEST", lifetime_seconds=3600)

    return AuthenticationBackend(name="jwt_test", transport=bearer, get_strategy=get_strategy)


@pytest.fixture
def in_memory_session_db():
    return InMemorySessionDB()


@pytest.fixture
def session_manager(in_memory_session_db):
    """
    Return solver's SessionManager if present. If missing, return a proxy that
    fails when session API methods are used (so tests show FAILs rather than fixture ERRORs).
    """
    try:
        from fastapi_users.extensions.session_manager import SessionManager  # solver's class
    except Exception:
        class MissingSessionManagerProxy:
            def __init__(self):
                self._msg = (
                    "Solver must define SessionManager in "
                    "fastapi_users/extensions/session_manager.py"
                )
                # provide an empty router so app.include_router() works during fixtures
                self.router = APIRouter()

            async def create_session(self, *args, **kwargs):
                pytest.fail(self._msg, pytrace=False)

            async def get_by_token(self, *args, **kwargs):
                pytest.fail(self._msg, pytrace=False)

            async def list_for_user(self, *args, **kwargs):
                pytest.fail(self._msg, pytrace=False)

            async def delete_by_id(self, *args, **kwargs):
                pytest.fail(self._msg, pytrace=False)

        return MissingSessionManagerProxy()

    # instantiate solver SessionManager wired to our in-memory DB
    return SessionManager(session_db=in_memory_session_db)


@pytest.fixture
def fastapi_users_instance(auth_backend):
    async def get_user_manager():
        return DummyUserManager(user_db=None)
    return FastAPIUsers(get_user_manager, [auth_backend])


@pytest_asyncio.fixture
async def test_app(fastapi_users_instance: FastAPIUsers, auth_backend: AuthenticationBackend, session_manager):
    """
    Create test FastAPI app including the solver's session router.
    If the session manager does not expose a router, fail gracefully instead of erroring.
    """
    app = FastAPI()

    # Expect the solver to expose a router attribute (APIRouter) on the manager
    if not hasattr(session_manager, "router"):
        pytest.fail(
            "Solver's SessionManager must expose a FastAPI router at `SessionManager.router`.",
            pytrace=False,
        )

    try:
        router = session_manager.router
    except Exception as e:
        pytest.fail(f"Error retrieving session router from SessionManager: {e}", pytrace=False)

    app.include_router(
        router,
        prefix="/auth/sessions",
        tags=["sessions"],
    )
    yield app


# ---------------- Sanity test for create_session ----------------
@pytest.mark.asyncio
async def test_session_manager_create_session_exists(session_manager):
    """
    Ensure solver's SessionManager implements create_session and returns a session-like object.
    """
    user_id = uuid.uuid4()
    s = await session_manager.create_session(user_id=user_id, token="probe_token")
    assert s is not None, "create_session returned None"
    assert getattr(s, "token", None) == "probe_token" or isinstance(getattr(s, "token", None), str)
    assert getattr(s, "id", None) is not None


# ---------------- Functional tests (list / delete / delete-all / ownership) ----------------

@pytest.mark.asyncio
async def test_list_user_sessions(test_app: FastAPI, session_manager):
    """
    GET /auth/sessions should list active sessions for the authenticated user.
    """
    user_id = uuid.uuid4()
    s1 = await session_manager.create_session(user_id=user_id, token="tok_1")
    s2 = await session_manager.create_session(user_id=user_id, token="tok_2")

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/auth/sessions", headers={"Authorization": f"Bearer {s1.token}"})
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert isinstance(data, list)
        tokens = {d.get("token") for d in data}
        assert "tok_1" in tokens and "tok_2" in tokens


@pytest.mark.asyncio
async def test_delete_single_session(test_app: FastAPI, session_manager):
    """
    DELETE /auth/sessions/{id} should remove that specific session for its owner.
    After deletion the deleted token should no longer authenticate.
    """
    user_id = uuid.uuid4()
    s = await session_manager.create_session(user_id=user_id, token="tok_del")

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # delete the session
        resp = await client.delete(f"/auth/sessions/{s.id}", headers={"Authorization": f"Bearer {s.token}"})
        assert resp.status_code in (200, 204), f"Unexpected status {resp.status_code}"

        # Token should no longer authenticate: GET /auth/sessions should be unauthorized (401)
        check = await client.get("/auth/sessions", headers={"Authorization": f"Bearer {s.token}"})
        assert check.status_code == 401, "Deleted session's token should be rejected (401)"


@pytest.mark.asyncio
async def test_delete_all_sessions(test_app: FastAPI, session_manager):
    """
    DELETE /auth/sessions should delete all sessions for the current user.
    After deletion tokens for that user are invalid; other user's sessions remain.
    """
    user_id = uuid.uuid4()
    tokens = []
    for i in range(3):
        s = await session_manager.create_session(user_id=user_id, token=f"tok_all_{i}")
        tokens.append(s.token)

    other_user = uuid.uuid4()
    other = await session_manager.create_session(user_id=other_user, token="tok_other")

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # delete all sessions for user_id using one of their tokens
        resp = await client.delete("/auth/sessions", headers={"Authorization": f"Bearer {tokens[0]}"})
        assert resp.status_code in (200, 204), f"Unexpected status {resp.status_code}"

        # all tokens for that user should now be rejected (401)
        for t in tokens:
            r = await client.get("/auth/sessions", headers={"Authorization": f"Bearer {t}"})
            assert r.status_code == 401, "Deleted user's token should be rejected (401)"

        # other user's token must still work
        r_other = await client.get("/auth/sessions", headers={"Authorization": f"Bearer {other.token}"})
        assert r_other.status_code == 200, "Other user's sessions must remain accessible"


@pytest.mark.asyncio
async def test_user_cannot_delete_others_session(test_app: FastAPI, session_manager):
    """
    Authorization: A user cannot delete another user's session.
    Expect 403 Forbidden.
    """
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    sess_b = await session_manager.create_session(user_id=user_b, token="tok_b")
    sess_a = await session_manager.create_session(user_id=user_a, token="tok_a")

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.delete(f"/auth/sessions/{sess_b.id}", headers={"Authorization": f"Bearer {sess_a.token}"})
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"
@pytest.mark.asyncio
async def test_delete_nonexistent_session_returns_404(test_app: FastAPI, session_manager):
    """
    DELETE /auth/sessions/{id} should return 404 when session does not exist,
    but only if the user is authenticated with a valid token.
    """
    # Create a real session for authentication
    user_id = uuid.uuid4()
    s = await session_manager.create_session(user_id=user_id, token="tok_valid")

    fake_session_id = uuid.uuid4()

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.delete(
            f"/auth/sessions/{fake_session_id}",
            headers={"Authorization": f"Bearer {s.token}"},  # valid token!
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"

@pytest.mark.asyncio
async def test_unauthenticated_access_returns_401(test_app: FastAPI):
    """
    Any session endpoint should require authentication.
    Missing Authorization header should yield 401.
    """
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/auth/sessions")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

        resp = await client.delete("/auth/sessions")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"


@pytest.mark.asyncio
async def test_invalid_token_returns_401(test_app: FastAPI):
    """
    Requests with invalid tokens should be rejected with 401 Unauthorized.
    """
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/auth/sessions", headers={"Authorization": "Bearer fake"})
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
