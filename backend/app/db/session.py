"""Database engine and session management.

- `engine` is the single connection pool for the whole app.
- `SessionLocal` builds short-lived sessions (one per request).
- `get_db` is a FastAPI dependency: it hands a session to a route and always
  closes it afterward, even if the route raises.
"""
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

# pool_pre_ping avoids "server closed the connection" errors after idle periods.
engine = create_engine(settings.database_url, pool_pre_ping=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
