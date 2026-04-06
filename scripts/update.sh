#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

FORCE=false
SKIP_BUILD=false
NO_MIGRATE=false
REGISTER_COMMANDS=false
ONLY_SERVICES=""
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
WORKDIR="${APP_DIR}"

usage() {
  cat <<'EOF'
Usage: ./scripts/update.sh [options]

Options:
  --app-dir=/path              Deployment directory. Defaults to the current repo root.
  --branch=branch              Git branch to update from. Defaults to main.
  --force                      Use git pull --rebase --autostash if the worktree is dirty.
  --skip-build                 Skip rebuilding Docker images.
  --only=api,bot               Restart only the listed services.
  --no-migrate                 Skip Prisma migrations.
  --register-commands          Re-register Discord slash commands after update.
  -h, --help                   Show this help message.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir=*)
      WORKDIR="${1#*=}"
      ;;
    --branch=*)
      DEPLOY_BRANCH="${1#*=}"
      ;;
    --force)
      FORCE=true
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
    --register-commands)
      REGISTER_COMMANDS=true
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

sync_git_checkout() {
  require_file "${WORKDIR}/docker-compose.yml"
  [[ -d "${WORKDIR}/.git" ]] || die "Update requires a git checkout at ${WORKDIR}."

  if ! git -C "${WORKDIR}" diff --quiet || ! git -C "${WORKDIR}" diff --cached --quiet; then
    if [[ "${FORCE}" == "true" ]]; then
      log_warning "Git worktree is dirty; using --autostash because --force was supplied."
    else
      die "Git worktree is dirty. Re-run with --force to allow git pull --rebase --autostash."
    fi
  fi

  git -C "${WORKDIR}" fetch origin "${DEPLOY_BRANCH}" --prune

  if git -C "${WORKDIR}" show-ref --verify --quiet "refs/heads/${DEPLOY_BRANCH}"; then
    git -C "${WORKDIR}" checkout "${DEPLOY_BRANCH}"
  else
    git -C "${WORKDIR}" checkout -B "${DEPLOY_BRANCH}" "origin/${DEPLOY_BRANCH}"
  fi

  if [[ "${FORCE}" == "true" ]]; then
    git -C "${WORKDIR}" pull --rebase --autostash origin "${DEPLOY_BRANCH}"
  else
    git -C "${WORKDIR}" pull --ff-only origin "${DEPLOY_BRANCH}"
  fi
}

main() {
  check_command docker curl git
  sync_git_checkout

  APP_DIR="${WORKDIR}"
  COMPOSE_FILE="${APP_DIR}/docker-compose.yml"
  ENV_FILE="${APP_DIR}/.env"
  DEPLOY_STATE_DIR="${APP_DIR}/.deploy"

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

  setup_runtime_permissions
  compose config >/dev/null

  local targets=()
  local check_api_health=false
  local service_name
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
    log_info "Rebuilding updated services..."
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

  log_info "Applying updated containers with minimal downtime..."
  compose up -d "${targets[@]}"

  if [[ "${REGISTER_COMMANDS}" == "true" ]]; then
    register_discord_commands
  fi

  if [[ "${check_api_health}" == "true" ]]; then
    health_check_api
  fi

  record_successful_release "${WORKDIR}"

  log_success "Update completed successfully."
}

main
