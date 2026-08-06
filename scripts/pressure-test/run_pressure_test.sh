#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_ENV_FILE="${ROOT_DIR}/.env.tencent"
GENERATED_ENV_FILE="${TMPDIR:-/tmp}/fasium-pressure-test.generated.env"
COMPOSE_BASE="${ROOT_DIR}/docker-compose.tencent.yml"
COMPOSE_PRESSURE="${ROOT_DIR}/docker-compose.pressure-test.yml"

usage() {
  cat <<'EOF'
Usage: run_pressure_test.sh up|down|status|logs

  up      Generate a temporary env file and start the pressure-test stack.
  down    Stop the pressure-test stack.
  status  Show container status.
  logs    Follow logs from the mock services.
EOF
}

generate_env() {
  if [[ ! -f "${BASE_ENV_FILE}" ]]; then
    echo "Missing base env file: ${BASE_ENV_FILE}" >&2
    exit 1
  fi

  cp "${BASE_ENV_FILE}" "${GENERATED_ENV_FILE}"
  cat <<'EOF' >> "${GENERATED_ENV_FILE}"

# Pressure test overrides
PRESSURE_TEST_MODE=true
RUNNINGHUB_API_KEY=pressure-test
RUNNINGHUB_HOST=http://mock-runninghub:8080

POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=Jototech
POSTGRES_PASSWORD=!QAZxsw2
POSTGRES_DATABASE=comfyui_tenant_service

LLM_SERVICE_URL=http://mock-models:9000/v1
LLM_API_KEY=pressure-test

IMAGE_PROVIDER=poloapi
POLOAPI_BASE_URL=http://mock-models:9000/v1
POLOAPI_TEXT_BASE_URL=http://mock-models:9000/v1
POLOAPI_IMAGE_BASE_URL=http://mock-models:9000/v1
POLOAPI_VIDEO_BASE_URL=http://mock-models:9000/v1
POLOAPI_APIKEY=pressure-test
POLOAPI_TEXT_APIKEY=pressure-test
POLOAPI_IMAGE_APIKEY=pressure-test
POLOAPI_VIDEO_APIKEY=pressure-test

VOD_SECRET_ID=
VOD_SECRET_KEY=
VOD_ENDPOINT=http://mock-runninghub:8080
EOF
}

compose() {
  cd "${ROOT_DIR}"
  docker compose --env-file "${GENERATED_ENV_FILE}" -f "${COMPOSE_BASE}" -f "${COMPOSE_PRESSURE}" "$@"
}

cmd="${1:-}"
case "${cmd}" in
  up)
    generate_env
    compose up -d --build --force-recreate
    ;;
  down)
    if [[ ! -f "${GENERATED_ENV_FILE}" ]]; then
      generate_env
    fi
    compose down
    ;;
  status)
    if [[ ! -f "${GENERATED_ENV_FILE}" ]]; then
      generate_env
    fi
    compose ps
    ;;
  logs)
    if [[ ! -f "${GENERATED_ENV_FILE}" ]]; then
      generate_env
    fi
    compose logs -f mock-models mock-runninghub tenant-service tenant-worker runninghub-service
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: ${cmd}" >&2
    usage
    exit 1
    ;;
esac
