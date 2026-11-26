import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import OperationalError

from app import database
from app.database import get_session
from app.main import app


class FlakyDialect:
    """指定した回数だけ接続に失敗する dialect の代わり。"""

    class loaded_dbapi:
        class OperationalError(Exception):
            pass

    def __init__(self, failures, message="(ENOTFOUND) tenant/user postgres.abc not found"):
        self.failures = failures
        self.message = message
        self.attempts = 0

    def connect(self):
        self.attempts += 1
        if self.attempts <= self.failures:
            raise self.loaded_dbapi.OperationalError(self.message)
        return "connection"


@pytest.fixture
def waits(monkeypatch):
    recorded = []
    monkeypatch.setattr(database.time, "sleep", recorded.append)
    return recorded


def connect(dialect):
    return database.connect_with_retry(dialect, None, (), {})


def test_temporary_connection_failure_is_retried(waits):
    dialect = FlakyDialect(failures=2)
    assert connect(dialect) == "connection"
    assert dialect.attempts == 3
    assert waits == list(database.CONNECT_RETRY_DELAYS[:2])


def test_gives_up_after_the_last_delay(waits):
    dialect = FlakyDialect(failures=100)
    with pytest.raises(FlakyDialect.loaded_dbapi.OperationalError):
        connect(dialect)
    assert dialect.attempts == len(database.CONNECT_RETRY_DELAYS) + 1


def test_wrong_password_is_not_retried(waits):
    dialect = FlakyDialect(failures=100, message='FATAL: password authentication failed for user "postgres"')
    with pytest.raises(FlakyDialect.loaded_dbapi.OperationalError):
        connect(dialect)
    assert dialect.attempts == 1
    assert waits == []


def test_retry_works_as_a_sqlalchemy_connect_hook(waits):
    # 実際の SQLAlchemy のフックとして呼ばれても、失敗後に接続できること
    engine = create_engine("sqlite://")
    real_connect = engine.dialect.connect
    attempts = []

    def flaky(*args, **kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            raise engine.dialect.loaded_dbapi.OperationalError("temporary")
        return real_connect(*args, **kwargs)

    event.listen(engine, "do_connect", database.connect_with_retry)
    engine.dialect.connect = flaky
    with engine.connect() as conn:
        assert conn.execute(text("SELECT 1")).scalar() == 1
    assert len(attempts) == 2


def test_database_outage_returns_503_that_the_browser_can_read():
    def unavailable():
        raise OperationalError("SELECT 1", {}, Exception("connection failed"))

    app.dependency_overrides[get_session] = unavailable
    try:
        response = TestClient(app).get("/api/catalog", headers={"Origin": "http://localhost:5173"})
    finally:
        app.dependency_overrides.pop(get_session)
    assert response.status_code == 503
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
