"""Health-check endpoints.

- GET /health     -> is the API process up?
- GET /health/db  -> can the API actually reach Postgres?

These are the first thing you hit after `docker compose up`, and later what a
load balancer or uptime monitor will poll.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/health/db")
def health_db(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}
