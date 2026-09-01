"""Application settings, loaded from environment variables (or a .env file).

Every setting can be overridden with an env var of the same name (case-insensitive),
which is how Docker Compose injects them in development and how the VPS will in prod.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Brain API"
    environment: str = "development"

    # Database. Compose points this at the "db" service; locally you might use localhost.
    database_url: str = "postgresql://brain:brain@db:5432/brain"

    # Auth. Used from Phase 2 onward. NEVER ship the default secret.
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14

    # CORS: comma-separated list of allowed frontend origins.
    cors_origins: str = "http://localhost:5173,http://localhost:8080"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
