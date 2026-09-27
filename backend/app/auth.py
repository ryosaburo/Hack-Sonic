import os
from functools import lru_cache

import jwt
from fastapi import HTTPException

# Supabase Auth が発行したアクセストークン（JWT）を検証し、ユーザーID（sub）を取り出す。
# 新しいプロジェクトは非対称鍵（JWKS で公開鍵を配布）、古いプロジェクトは共有シークレット（HS256）で署名する。
#   SUPABASE_URL        : https://<project-ref>.supabase.co（JWKS と発行元の確認に使う）
#   SUPABASE_JWT_SECRET : 旧方式の JWT Secret（設定されていれば HS256 のトークンも受け付ける）
AUDIENCE = "authenticated"


def _supabase_url() -> str:
    return os.getenv("SUPABASE_URL", "").rstrip("/")


@lru_cache(maxsize=4)
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json", cache_keys=True)


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=401, detail="Invalid or expired login")


def verify_access_token(token: str) -> str:
    try:
        algorithm = jwt.get_unverified_header(token).get("alg")
    except jwt.PyJWTError:
        raise _unauthorized()

    url = _supabase_url()
    secret = os.getenv("SUPABASE_JWT_SECRET")
    options = {"require": ["exp", "sub"]}
    issuer = f"{url}/auth/v1" if url else None
    try:
        if algorithm == "HS256":
            if not secret:
                raise _unauthorized()
            claims = jwt.decode(token, secret, algorithms=["HS256"], audience=AUDIENCE, issuer=issuer, options=options)
        elif algorithm in ("ES256", "RS256"):
            if not url:
                raise _unauthorized()
            key = _jwks_client(url).get_signing_key_from_jwt(token).key
            claims = jwt.decode(token, key, algorithms=[algorithm], audience=AUDIENCE, issuer=issuer, options=options)
        else:
            raise _unauthorized()
    except jwt.PyJWTError:
        raise _unauthorized()
    return str(claims["sub"])


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized()
    return token
