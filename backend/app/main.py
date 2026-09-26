from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import create_db_and_tables, sync_catalog_from_seed
from .routers import cast, catalog, collection


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    sync_catalog_from_seed()
    yield


app = FastAPI(title="Space Fishing API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(catalog.router)
app.include_router(collection.router)
app.include_router(cast.router)


@app.get("/")
def root():
    return {"status": "ok"}
