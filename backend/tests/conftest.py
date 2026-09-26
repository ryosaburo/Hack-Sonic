import os
import tempfile

# app.database reads DATABASE_URL at import time, so this must run before
# any test module imports app.main / app.database.
# TEST_DATABASE_URL を指定すると、そのDB（本番と同じPostgresなど）でテストする。中身は毎回作り直す。
_tmp_dir = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL") or f"sqlite:///{os.path.join(_tmp_dir, 'test.db')}"
os.environ.pop("SPACE_FISHING_TEST_POINTS", None)

if os.getenv("TEST_DATABASE_URL"):
    from sqlmodel import SQLModel

    from app.database import engine

    SQLModel.metadata.drop_all(engine)
