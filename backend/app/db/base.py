"""The declarative base every ORM model inherits from.

Models (User, Thought, ...) will subclass this. Alembic reads Base.metadata
to know what tables should exist when it generates migrations.
"""
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
