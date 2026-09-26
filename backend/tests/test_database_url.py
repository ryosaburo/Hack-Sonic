from app.database import normalize_database_url


def test_supabase_urls_use_the_bundled_psycopg_driver():
    url = "postgresql://postgres.abc:pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require"
    assert normalize_database_url(url) == url.replace("postgresql://", "postgresql+psycopg://", 1)
    assert normalize_database_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"


def test_other_urls_are_left_as_is():
    assert normalize_database_url("sqlite:///./dev.db") == "sqlite:///./dev.db"
    assert normalize_database_url("postgresql+psycopg://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
