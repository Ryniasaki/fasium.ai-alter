from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, List

from sqlalchemy import MetaData, create_engine, text


TABLES: List[str] = [
    "tenants",
    "users",
    "api_usage",
    "model_billing_rates",
    "billing_usage",
    "tenant_task_records",
    "poloapi_usage_records",
    "tenant_projects",
    "tenant_project_shares",
    "tenant_project_invites",
    "tenant_lora",
]


def _postgres_url() -> str:
    host = os.getenv("POSTGRES_HOST", "127.0.0.1")
    port = os.getenv("POSTGRES_PORT", "5432")
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "postgres")
    database = os.getenv("POSTGRES_DATABASE", "comfyui_tenant_service")
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{database}"


def _reset_sequences(pg_engine, table: str) -> None:
    with pg_engine.begin() as conn:
        for pk_column in ("id",):
            conn.execute(
                text(
                    f"""
                    SELECT setval(
                        pg_get_serial_sequence('{table}', '{pk_column}'),
                        COALESCE((SELECT MAX({pk_column}) FROM {table}), 1),
                        (SELECT MAX({pk_column}) IS NOT NULL FROM {table})
                    )
                    """
                )
            )


def migrate(sqlite_path: Path) -> Dict[str, int]:
    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite file not found: {sqlite_path}")

    sqlite_engine = create_engine(f"sqlite:///{sqlite_path}")
    pg_engine = create_engine(_postgres_url())

    src_meta = MetaData()
    src_meta.reflect(bind=sqlite_engine)
    dst_meta = MetaData()
    dst_meta.reflect(bind=pg_engine)

    copied: Dict[str, int] = {}

    for table_name in TABLES:
        if table_name not in src_meta.tables:
            copied[table_name] = 0
            continue
        if table_name not in dst_meta.tables:
            raise RuntimeError(
                f"Target table missing in PostgreSQL: {table_name}. "
                "Please initialize schema first."
            )

        src_table = src_meta.tables[table_name]
        dst_table = dst_meta.tables[table_name]

        with sqlite_engine.connect() as src_conn:
            rows = [dict(row) for row in src_conn.execute(src_table.select()).mappings().all()]

        with pg_engine.begin() as dst_conn:
            # Use DELETE for compatibility with FK constraints and minimal assumptions.
            dst_conn.execute(dst_table.delete())
            if rows:
                dst_conn.execute(dst_table.insert(), rows)

        copied[table_name] = len(rows)

        if "id" in dst_table.columns:
            _reset_sequences(pg_engine, table_name)

    return copied


if __name__ == "__main__":
    default_sqlite = Path(__file__).resolve().parents[1] / "tenant_service.db"
    sqlite_file = Path(os.getenv("SQLITE_PATH", str(default_sqlite)))
    result = migrate(sqlite_file)
    print("SQLITE_TO_POSTGRES_DONE")
    for name, count in result.items():
        print(f"{name}: {count}")
