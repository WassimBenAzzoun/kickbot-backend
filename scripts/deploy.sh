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
APP_REPO_URL="${APP_REPO_URL:-${REPO_URL:-}}"
WORKDIR="${APP_DIR}"

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy.sh [options]

Options:
  --app-dir=/path              Deployment directory. Defaults to the current repo root.
  --repo-url=https://...       Clone this repository if the app directory does not exist yet.
  --branch=branch              Git branch to deploy. Defaults to main.
  --force                      Allow deploy to continue when optional services are missing.
  --skip-build                 Skip the Docker build step and reuse existing images.
  --only=api,bot               Deploy only the listed services.
  --no-migrate                 Skip Prisma migrations.
  --register-commands          Register Discord slash commands after deploy.
  -h, --help                   Show this help message.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir=*)
      WORKDIR="${1#*=}"
      ;;
    --repo-url=*)
      APP_REPO_URL="${1#*=}"
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

prepare_workdir() {
  if [[ -d "${WORKDIR}/.git" ]]; then
    log_info "Using existing git checkout at ${WORKDIR}."
    return 0
  fi

  if [[ -f "${WORKDIR}/docker-compose.yml" ]]; then
    log_warning "Using ${WORKDIR} without git metadata. Update and rollback will require a proper clone."
    return 0
  fi

  if [[ -z "${APP_REPO_URL}" ]]; then
    die "App directory ${WORKDIR} does not contain a deployable checkout. Provide --repo-url to allow cloning."
  fi

  ensure_directory "$(dirname "${WORKDIR}")" 750
  log_info "Cloning ${APP_REPO_URL} into ${WORKDIR}..."
  git clone --branch "${DEPLOY_BRANCH}" --single-branch "${APP_REPO_URL}" "${WORKDIR}"
}

sync_repo_if_available() {
  if [[ ! -d "${WORKDIR}/.git" ]]; then
    log_warning "Skipping git sync because ${WORKDIR} is not a git checkout."
    return 0
  fi

  ensure_clean_git_tree "${WORKDIR}"
  git -C "${WORKDIR}" fetch origin "${DEPLOY_BRANCH}" --prune

  if git -C "${WORKDIR}" show-ref --verify --quiet "refs/heads/${DEPLOY_BRANCH}"; then
    git -C "${WORKDIR}" checkout "${DEPLOY_BRANCH}"
  else
    git -C "${WORKDIR}" checkout -B "${DEPLOY_BRANCH}" "origin/${DEPLOY_BRANCH}"
  fi

  git -C "${WORKDIR}" pull --ff-only origin "${DEPLOY_BRANCH}"
}

main() {
  check_command docker curl git
  prepare_workdir
  sync_repo_if_available

  APP_DIR="${WORKDIR}"
  COMPOSE_FILE="${APP_DIR}/docker-compose.yml"
  ENV_FILE="${APP_DIR}/.env"
  DEPLOY_STATE_DIR="${APP_DIR}/.deploy"

  require_file "${COMPOSE_FILE}"
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

  if [[ "${FORCE}" != "true" && -n "${ONLY_SERVICES}" ]]; then
    IFS=',' read -r -a requested <<< "${ONLY_SERVICES}"
    if [[ ${#targets[@]} -ne ${#requested[@]} ]]; then
      die "One or more requested services are not present in ${COMPOSE_FILE}. Re-run with --force to skip missing services."
    fi
  fi

  if compose_service_exists "postgres"; then
    log_info "Starting PostgreSQL..."
    compose up -d postgres
    wait_for_container_health "postgres" 30 3
  fi

  if [[ "${SKIP_BUILD}" != "true" ]]; then
    log_info "Building Docker images..."
    compose build "${targets[@]}"

    if compose_service_exists "migrate"; then
      compose build migrate
    fi
  else
    log_warning "Skipping Docker image build."
  fi

  if [[ "${NO_MIGRATE}" != "true" ]]; then
    run_migrations
  else
    log_warning "Skipping Prisma migrations."
  fi

  log_info "Starting application services..."
  compose up -d "${targets[@]}"

  if [[ "${REGISTER_COMMANDS}" == "true" ]]; then
    register_discord_commands
  fi

  if [[ "${check_api_health}" == "true" ]]; then
    health_check_api
  fi

  record_successful_release "${WORKDIR}"

  log_success "Deployment completed successfully."
}

main
