from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CENOTE_", env_file=".env", extra="ignore")

    db_path: Path = Path("/data/cenote.duckdb")
    log_level: str = "INFO"
    aws_profile: str = "default"
    aws_region: str = "us-east-1"


settings = Settings()
