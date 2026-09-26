import os
import tempfile

# app.database reads DATABASE_URL at import time, so this must run before
# any test module imports app.main / app.database.
_tmp_dir = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(_tmp_dir, 'test.db')}"
os.environ.pop("SPACE_FISHING_TEST_POINTS", None)
