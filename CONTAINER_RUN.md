# Container Quick Start

## Prerequisites

- Docker Desktop (or Docker Engine + Compose)

## Run

```bash
docker compose up -d --build
```

## Services

- Frontend: `http://localhost:3000`
- Tenant service: `http://localhost:8081`
- Runninghub service: `http://localhost:8080`
- Redis: `localhost:6379`
- PostgreSQL: `localhost:5432`
- Tenant worker: background process (RQ)

## Notes

- Set real secrets before production use:
  - `RUNNINGHUB_API_KEY`
  - `SECRET_KEY`
  - `GEMINI_API_KEY`
- Queue-related env vars:
  - `REDIS_URL`
  - `TASK_QUEUE_ENABLED`
  - `TASK_QUEUE_NAME`
- PostgreSQL env vars (for migration testing):
  - `STORAGE_TYPE=postgresql`
  - `POSTGRES_HOST`
  - `POSTGRES_PORT`
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
  - `POSTGRES_DATABASE`
- The default values in `docker-compose.yml` are placeholders for local bring-up only.
