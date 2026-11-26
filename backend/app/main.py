import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from .database import create_db_and_tables, sync_catalog_from_seed
from .routers import account, cast, catalog, collection, economy

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    sync_catalog_from_seed()
    yield


app = FastAPI(title="Space Fishing API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # 本番のフロントのURLは CORS_ORIGINS にカンマ区切りで足す（例: https://example.vercel.app）
    allow_origins=["http://localhost:5173", *filter(None, (o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",")))],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(OperationalError)
def database_unavailable(request: Request, error: OperationalError):
    # ここで応答を返すと自動ではログに残らないので、原因を追えるように記録する
    logger.error("Database error on %s %s", request.method, request.url.path, exc_info=error)
    return JSONResponse({"detail": "Database temporarily unavailable"}, status_code=503)


app.include_router(catalog.router)
app.include_router(collection.router)
app.include_router(cast.router)
app.include_router(economy.router)
app.include_router(account.router)


@app.get("/")
def root():
    return {"status": "ok"}
