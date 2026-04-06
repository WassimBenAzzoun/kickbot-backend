#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

WORKDIR="${APP_DIR}"
ROLLBACK_COMMIT=""
SKIP_BUILD=false
NO_MIGRATE=false
ONLY_SERVICES=""
FORCE=false

usage() {
  cat <<'EOF'
Usage: ./scripts/rollback.sh [options]

Options:
  --app-dir=/path              Deployment directory. Defaults to the current repo root.
  --commit=<sha>               Roll back to a specific git commit.
  --skip-build                 Skip image rebuild and reuse existing images.
  --only=api,bot               Restart only the listed services.
  --no-migrate                 Skip Prisma migrations during rollback.
  --force                      Allow rollback from a detached HEAD or when previous_release is missing.
  -h, --help                   Show this help message.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir=*)
      WORKDIR="${1#*=}"
      ;;
    --commit=*)
      ROLLBACK_COMMIT="${1#*=}"
      ;;
    --skip-build)
      SKIP_BUILD=true
      ;;
    --only=*)
      ONLY_SERVICES="${1#*=}"
      ;;
    --no-migrate)
      NO_MIGRATE=true
      ;;
    --force)
      FORCE=true
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

resolve_rollback_target() {
  if [[ -n "${ROLLBACK_COMMIT}" ]]; then
    printf "%s" "${ROLLBACK_COMMIT}"
    return 0
  fi

  if [[ -f "${DEPLOY_STATE_DIR}/previous_release" ]]; then
    tr -d '\r\n' < "${DEPLOY_STATE_DIR}/previous_release"
    return 0
  fi

  if [[ "${FORCE}" == "true" ]]; then
    git -C "${WORKDIR}" rev-parse HEAD^
    return 0
  fi

  die "No previous release marker found. Re-run with --force to fall back to HEAD^ or specify --commit."
}

main() {
  check_command docker curl git

  APP_DIR="${WORKDIR}"
  COMPOSE_FILE="${APP_DIR}/docker-compose.yml"
  ENV_FILE="${APP_DIR}/.env"
  DEPLOY_STATE_DIR="${APP_DIR}/.deploy"

  require_file "${COMPOSE_FILE}"
  [[ -d "${WORKDIR}/.git" ]] || die "Rollback requires a git checkout at ${WORKDIR}."

  check_env "${ENV_FILE}" \
    DATABASE_URL \
    DISCORD_TOKEN \
    DISCORD_CLIENT_ID \
    DISCORD_CLIENT_SECRET \
    KICK_CLIENT_ID \
    KICK_CLIENT_SECRET \
    API_BASE_URL \
    FRONTEND_URL \
    CORS_ORIGIN \
    JWT_SECRET

  if ! git -C "${WORKDIR}" diff --quiet || ! git -C "${WORKDIR}" diff --cached --quiet; then
    die "Rollback cannot proceed with local git changes present."
  fi

  setup_runtime_permissions
  compose config >/dev/null

  local target_commit
  local targets=()
  local check_api_health=false
  local service_name

  target_commit="$(resolve_rollback_target)"
  git -C "${WORKDIR}" rev-parse --verify "${target_commit}^{commit}" >/dev/null

  log_warning "Rolling back application code to ${target_commit}. Database schema rollback is not automatic."
  git -C "${WORKDIR}" checkout "${target_commit}"

  resolve_target_services "${ONLY_SERVICES}" true targets

  if compose_service_exists "api"; then
    if [[ -z "${ONLY_SERVICES}" ]]; then
      check_api_health=true
    else
      for service_name in "${targets[@]}"; do
        if [[ "${service_name}" == "api" ]]; then
          check_api_health=true
          break
        fi
      done
    fi
  fi

  if compose_service_exists "postgres"; then
    compose up -d postgres
    wait_for_container_health "postgres" 30 3
  fi

  if [[ "${SKIP_BUILD}" != "true" ]]; then
    log_info "Rebuilding containers for the rollback target..."
    compose build "${targets[@]}"

    if compose_service_exists "migrate"; then
      compose build migrate
    fi
  else
    log_warning "Skipping image rebuild."
  fi

  if [[ "${NO_MIGRATE}" != "true" ]]; then
    run_migrations
  else
    log_warning "Skipping Prisma migrations."
  fi

  compose up -d "${targets[@]}"

  if [[ "${check_api_health}" == "true" ]]; then
    health_check_api
  fi

  record_successful_release "${WORKDIR}"

  log_success "Rollback completed successfully. When you are ready to resume normal updates, run update.sh with the desired branch."
}

main
