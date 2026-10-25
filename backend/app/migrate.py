"""Run Alembic migrations programmatically (used at startup, restore, and by scripts)."""
from __future__ import annotations

from alembic import command
from alembic.config import Config

from . import config


def alembic_config() -> Config:
    cfg = Config(str(config.BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(config.BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{config.DB_PATH}")
    cfg.attributes["configure_logger"] = False  # keep the app's logging configuration
    return cfg


def upgrade() -> None:
    config.ensure_dirs()
    command.upgrade(alembic_config(), "head")


if __name__ == "__main__":
    upgrade()
    print(f"Database at {config.DB_PATH} is up to date.")
