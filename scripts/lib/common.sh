#!/usr/bin/env bash
set -euo pipefail

umask 027

SCRIPT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_ROOT="$(cd "${SCRIPT_LIB_DIR}/../.." && pwd)"

REPO_ROOT="${REPO_ROOT:-$DEFAULT_REPO_ROOT}"
APP_NAME="${APP_NAME:-kick-platform}"
APP_DIR="${APP_DIR:-$REPO_ROOT}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-$APP_DIR/.deploy}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-kick-platform}"

if [[ -t 1 ]]; then
  COLOR_BLUE="$(printf '\033[34m')"
  COLOR_GREEN="$(printf '\033[32m')"
  COLOR_YELLOW="$(printf '\033[33m')"
  COLOR_RED="$(printf '\033[31m')"
  COLOR_RESET="$(printf '\033[0m')"
else
  COLOR_BLUE=""
  COLOR_GREEN=""
  COLOR_YELLOW=""
  COLOR_RED=""
  COLOR_RESET=""
fi

log_info() {
  printf "%s[INFO]%s %s\n" "${COLOR_BLUE}" "${COLOR_RESET}" "$*"
}

log_success() {
  printf "%s[SUCCESS]%s %s\n" "${COLOR_GREEN}" "${COLOR_RESET}" "$*"
}

log_warning() {
  printf "%s[WARNING]%s %s\n" "${COLOR_YELLOW}" "${COLOR_RESET}" "$*"
}

log_error() {
  printf "%s[ERROR]%s %s\n" "${COLOR_RED}" "${COLOR_RESET}" "$*"
}

die() {
  log_error "$*"
  exit 1
}

check_command() {
  local command_name

  for command_name in "$@"; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      die "Required command '${command_name}' is not installed or not on PATH."
    fi
  done
}

require_file() {
  local target_path="$1"

  [[ -f "${target_path}" ]] || die "Required file not found: ${target_path}"
}

ensure_directory() {
  local target_dir="$1"
  local mode="${2:-750}"

  install -d -m "${mode}" "${target_dir}"
}

secure_file_permissions() {
  local target_path="$1"
  local mode="${2:-640}"

  if [[ -e "${target_path}" ]]; then
    chmod "${mode}" "${target_path}"
  fi
}

secure_script_permissions() {
  local target_dir="$1"

  if [[ -d "${target_dir}" ]]; then
    find "${target_dir}" -type f -name "*.sh" -exec chmod 750 {} \;
  fi
}

get_env_value() {
  local env_file="$1"
  local key="$2"
  local line

  [[ -f "${env_file}" ]] || return 1

  line="$(grep -E "^[[:space:]]*${key}=" "${env_file}" | tail -n 1 || true)"
  [[ -n "${line}" ]] || return 1

  line="${line#*=}"
  line="${line%$'\r'}"

  if [[ "${line}" == \"*\" && "${line}" == *\" ]]; then
    line="${line:1:${#line}-2}"
  elif [[ "${line}" == \'*\' && "${line}" == *\' ]]; then
    line="${line:1:${#line}-2}"
  fi

  printf "%s" "${line}"
}

check_env() {
  local env_file="$1"
  shift

  require_file "${env_file}"

  local missing=()
  local key
  local value

  for key in "$@"; do
    value="$(get_env_value "${env_file}" "${key}" || true)"

    if [[ -z "${value// }" ]]; then
      missing+=("${key}")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    die "Missing required environment variables in ${env_file}: ${missing[*]}"
  fi
}

wait_for_service() {
  local service_name="$1"
  local service_url="$2"
  local max_attempts="${3:-30}"
  local sleep_seconds="${4:-2}"
  local attempt

  check_command curl

  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    if curl --fail --silent --show-error --location --max-time 10 "${service_url}" >/dev/null 2>&1; then
      log_success "${service_name} is responding at ${service_url}"
      return 0
    fi

    sleep "${sleep_seconds}"
  done

  die "${service_name} did not become ready after ${max_attempts} attempts."
}

wait_for_container_health() {
  local service_name="$1"
  local max_attempts="${2:-30}"
  local sleep_seconds="${3:-2}"
  local container_id
  local status
  local attempt

  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    container_id="$(compose ps -q "${service_name}" 2>/dev/null || true)"

    if [[ -n "${container_id}" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"

      if [[ "${status}" == "healthy" || "${status}" == "running" ]]; then
        log_success "Service '${service_name}' is ${status}."
        return 0
      fi
    fi

    sleep "${sleep_seconds}"
  done

  die "Service '${service_name}' failed to become healthy."
}

compose() {
  check_command docker
  docker compose --project-name "${COMPOSE_PROJECT_NAME}" -f "${COMPOSE_FILE}" "$@"
}

compose_service_exists() {
  local service_name="$1"

  compose config --services | grep -Fxq "${service_name}"
}

resolve_target_services() {
  local requested_csv="${1:-}"
  local include_infra="${2:-false}"
  local -n resolved_ref="$3"
  local available
  local requested_list=()
  local service_name

  resolved_ref=()

  if [[ -n "${requested_csv}" ]]; then
    IFS=',' read -r -a requested_list <<< "${requested_csv}"
  else
    requested_list=(api frontend bot)

    if [[ "${include_infra}" == "true" ]]; then
      requested_list+=(caddy)
    fi
  fi

  for service_name in "${requested_list[@]}"; do
    case "${service_name}" in
      api|frontend|bot|postgres|caddy)
        ;;
      *)
        die "Unsupported service passed to --only: ${service_name}"
        ;;
    esac

    if compose_service_exists "${service_name}"; then
      resolved_ref+=("${service_name}")
    else
      log_warning "Service '${service_name}' is not defined in ${COMPOSE_FILE}; skipping it."
    fi
  done

  if [[ ${#resolved_ref[@]} -eq 0 ]]; then
    available="$(compose config --services | tr '\n' ' ' | sed 's/[[:space:]]\+$//')"
    die "No target services matched the compose file. Available services: ${available}"
  fi
}

parse_database_url() {
  local database_url="$1"

  if [[ "${database_url}" =~ ^postgres(ql)?://([^:/?#]+):([^@/?#]+)@([^:/?#]+)(:([0-9]+))?/([^?]+) ]]; then
    DB_URL_USER="${BASH_REMATCH[2]}"
    DB_URL_PASSWORD="${BASH_REMATCH[3]}"
    DB_URL_HOST="${BASH_REMATCH[4]}"
    DB_URL_PORT="${BASH_REMATCH[6]:-5432}"
    DB_URL_NAME="${BASH_REMATCH[7]}"
    DB_URL_NAME="${DB_URL_NAME%%\?*}"
    export DB_URL_USER DB_URL_PASSWORD DB_URL_HOST DB_URL_PORT DB_URL_NAME
    return 0
  fi

  die "DATABASE_URL is not in a supported PostgreSQL URL format."
}

run_migrations() {
  if compose_service_exists "migrate"; then
    log_info "Running Prisma migrations via the 'migrate' service..."
    compose run --rm migrate
    return 0
  fi

  if compose_service_exists "api"; then
    log_info "Running Prisma migrations via the 'api' service..."
    compose run --rm --no-deps api npm run prisma:migrate:deploy
    return 0
  fi

  die "Unable to run migrations because neither 'migrate' nor 'api' exists in compose."
}

register_discord_commands() {
  if compose_service_exists "api"; then
    log_info "Registering Discord application commands..."
    compose run --rm --no-deps api npm run register:commands
    return 0
  fi

  if compose_service_exists "bot"; then
    log_info "Registering Discord application commands via the bot image..."
    compose run --rm --no-deps bot npm run register:commands
    return 0
  fi

  die "Unable to register commands because neither 'api' nor 'bot' exists in compose."
}

health_check_api() {
  local api_port
  local health_url

  api_port="$(get_env_value "${ENV_FILE}" "API_PORT" || true)"
  api_port="${api_port:-4000}"
  health_url="${API_HEALTH_URL:-http://127.0.0.1:${api_port}/health}"

  wait_for_service "API health check" "${health_url}" 40 3
}

ensure_clean_git_tree() {
  local repo_dir="$1"

  if ! git -C "${repo_dir}" diff --quiet || ! git -C "${repo_dir}" diff --cached --quiet; then
    die "The git worktree at ${repo_dir} has uncommitted changes. Commit or stash them before continuing."
  fi
}

record_successful_release() {
  local repo_dir="$1"
  local current_sha

  if [[ ! -d "${repo_dir}/.git" ]]; then
    log_warning "Skipping release marker update because ${repo_dir} is not a git checkout."
    return 0
  fi

  ensure_directory "${DEPLOY_STATE_DIR}" 750

  current_sha="$(git -C "${repo_dir}" rev-parse HEAD)"

  if [[ -f "${DEPLOY_STATE_DIR}/current_release" ]]; then
    cp "${DEPLOY_STATE_DIR}/current_release" "${DEPLOY_STATE_DIR}/previous_release"
    secure_file_permissions "${DEPLOY_STATE_DIR}/previous_release" 640
  fi

  printf "%s\n" "${current_sha}" > "${DEPLOY_STATE_DIR}/current_release"
  printf "%s %s\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "${current_sha}" >> "${DEPLOY_STATE_DIR}/releases.log"

  secure_file_permissions "${DEPLOY_STATE_DIR}/current_release" 640
  secure_file_permissions "${DEPLOY_STATE_DIR}/releases.log" 640
}

setup_runtime_permissions() {
  ensure_directory "${DEPLOY_STATE_DIR}" 750
  secure_file_permissions "${ENV_FILE}" 600
  secure_script_permissions "${APP_DIR}/scripts"
}
