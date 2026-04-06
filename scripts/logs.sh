#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

TARGET="${1:-all}"
WORKDIR="${APP_DIR}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/logs.sh api
  ./scripts/logs.sh frontend
  ./scripts/logs.sh bot
  ./scripts/logs.sh all
EOF
}

main() {
  if [[ "${TARGET}" == "-h" || "${TARGET}" == "--help" ]]; then
    usage
    exit 0
  fi

  APP_DIR="${WORKDIR}"
  COMPOSE_FILE="${APP_DIR}/docker-compose.yml"
  ENV_FILE="${APP_DIR}/.env"

  require_file "${COMPOSE_FILE}"
  check_command docker
  compose config >/dev/null

  case "${TARGET}" in
    all)
      log_info "Streaming logs for all compose services..."
      compose logs -f --tail=200
      ;;
    api|frontend|bot|postgres|caddy|migrate)
      if ! compose_service_exists "${TARGET}"; then
        die "Service '${TARGET}' is not defined in ${COMPOSE_FILE}."
      fi

      log_info "Streaming logs for '${TARGET}'..."
      compose logs -f --tail=200 "${TARGET}"
      ;;
    *)
      die "Unsupported log target '${TARGET}'. Use api, frontend, bot, postgres, caddy, migrate, or all."
      ;;
  esac
}

main
