#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

WORKDIR="${APP_DIR}"
BACKUP_DIR="${BACKUP_DIR:-/backups/${APP_NAME}}"
RETENTION_COUNT="${RETENTION_COUNT:-7}"

usage() {
  cat <<'EOF'
Usage: ./scripts/backup.sh [options]

Options:
  --app-dir=/path              Deployment directory. Defaults to the current repo root.
  --backup-dir=/path           Backup output directory. Defaults to /backups/kick-platform.
  --retention=7                Number of backups to keep.
  -h, --help                   Show this help message.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir=*)
      WORKDIR="${1#*=}"
      ;;
    --backup-dir=*)
      BACKUP_DIR="${1#*=}"
      ;;
    --retention=*)
      RETENTION_COUNT="${1#*=}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac

  shift
done

cleanup_old_backups() {
  mapfile -t backup_files < <(find "${BACKUP_DIR}" -maxdepth 1 -type f -name '*.sql.gz' -printf '%T@ %p\n' | sort -nr | awk '{print $2}')

  if [[ ${#backup_files[@]} -le ${RETENTION_COUNT} ]]; then
    return 0
  fi

  local old_file
  for old_file in "${backup_files[@]:${RETENTION_COUNT}}"; do
    rm -f "${old_file}"
    log_info "Removed old backup ${old_file}"
  done
}

main() {
  check_command docker gzip find awk

  APP_DIR="${WORKDIR}"
  COMPOSE_FILE="${APP_DIR}/docker-compose.yml"
  ENV_FILE="${APP_DIR}/.env"

  require_file "${COMPOSE_FILE}"
  check_env "${ENV_FILE}" DATABASE_URL
  compose config >/dev/null

  if ! compose_service_exists "postgres"; then
    die "Backup requires a 'postgres' service in ${COMPOSE_FILE}."
  fi

  setup_runtime_permissions
  ensure_directory "${BACKUP_DIR}" 750

  local database_url
  local timestamp
  local backup_file

  database_url="$(get_env_value "${ENV_FILE}" "DATABASE_URL")"
  parse_database_url "${database_url}"

  compose up -d postgres
  wait_for_container_health "postgres" 30 3

  timestamp="$(date +"%Y%m%d-%H%M%S")"
  backup_file="${BACKUP_DIR}/postgres-${timestamp}.sql.gz"

  log_info "Creating PostgreSQL backup at ${backup_file}..."
  docker compose --project-name "${COMPOSE_PROJECT_NAME}" -f "${COMPOSE_FILE}" exec -T \
    -e PGPASSWORD="${DB_URL_PASSWORD}" \
    postgres \
    pg_dump -U "${DB_URL_USER}" -d "${DB_URL_NAME}" --clean --if-exists \
    | gzip -9 > "${backup_file}"

  secure_file_permissions "${backup_file}" 640
  cleanup_old_backups

  log_success "Backup completed successfully."
}

main
