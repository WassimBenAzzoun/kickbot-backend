#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

PROJECT_DIR="${PROJECT_DIR:-$HOME/kick-platform}"
DISABLE_PASSWORD_SSH=false
INSTALL_NODE=true
FORCE=false

usage() {
  cat <<'EOF'
Usage: ./scripts/setup-server.sh [options]

Options:
  --project-dir=/path          Directory to create for the deployed application.
  --disable-password-ssh       Disable SSH password authentication after validating config.
  --skip-node                  Skip Node.js LTS installation.
  --force                      Re-run package and repository setup even if components already exist.
  -h, --help                   Show this help message.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir=*)
      PROJECT_DIR="${1#*=}"
      ;;
    --disable-password-ssh)
      DISABLE_PASSWORD_SSH=true
      ;;
    --skip-node)
      INSTALL_NODE=false
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

if [[ "$(uname -s)" != "Linux" ]]; then
  die "setup-server.sh must be run on an Ubuntu Linux host."
fi

SUDO=""
if [[ "${EUID}" -ne 0 ]]; then
  check_command sudo
  sudo -v
  SUDO="sudo"
fi

TARGET_USER="${SUDO_USER:-$USER}"

install_base_packages() {
  log_info "Updating apt package metadata..."
  ${SUDO} apt update

  log_info "Applying package upgrades..."
  ${SUDO} DEBIAN_FRONTEND=noninteractive apt upgrade -y

  log_info "Installing required base packages..."
  ${SUDO} DEBIAN_FRONTEND=noninteractive apt install -y \
    curl \
    git \
    ufw \
    ca-certificates \
    gnupg \
    lsb-release \
    unzip
}

configure_firewall() {
  log_info "Configuring UFW..."
  ${SUDO} ufw allow OpenSSH >/dev/null
  ${SUDO} ufw allow 80/tcp >/dev/null
  ${SUDO} ufw allow 443/tcp >/dev/null

  if ${SUDO} ufw status | grep -q "Status: inactive"; then
    ${SUDO} ufw --force enable >/dev/null
  else
    ${SUDO} ufw reload >/dev/null
  fi

  log_success "Firewall rules applied for SSH, HTTP, and HTTPS."
}

install_docker() {
  log_info "Installing Docker Engine from the official Docker repository..."
  ${SUDO} install -m 0755 -d /etc/apt/keyrings

  if [[ ! -f /etc/apt/keyrings/docker.gpg || "${FORCE}" == "true" ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | ${SUDO} gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    ${SUDO} chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" \
    | ${SUDO} tee /etc/apt/sources.list.d/docker.list >/dev/null

  ${SUDO} apt update
  ${SUDO} DEBIAN_FRONTEND=noninteractive apt install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

  ${SUDO} systemctl enable --now docker
  ${SUDO} usermod -aG docker "${TARGET_USER}"
  log_success "Docker Engine and Compose plugin are installed."
}

install_node() {
  if [[ "${INSTALL_NODE}" != "true" ]]; then
    log_warning "Skipping Node.js installation by request."
    return 0
  fi

  log_info "Installing Node.js LTS from NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_lts.x | ${SUDO} bash -
  ${SUDO} DEBIAN_FRONTEND=noninteractive apt install -y nodejs
  log_success "Node.js LTS installed."
}

configure_ssh() {
  local sshd_config="/etc/ssh/sshd_config"
  local backup_path

  if [[ "${DISABLE_PASSWORD_SSH}" != "true" ]]; then
    log_warning "Password-based SSH authentication was not changed. Re-run with --disable-password-ssh after confirming SSH keys work."
    return 0
  fi

  check_command sshd

  backup_path="${sshd_config}.bak.$(date +%Y%m%d%H%M%S)"
  ${SUDO} cp "${sshd_config}" "${backup_path}"

  if grep -Eq '^[#[:space:]]*PasswordAuthentication' "${sshd_config}"; then
    ${SUDO} sed -i 's/^[#[:space:]]*PasswordAuthentication.*/PasswordAuthentication no/' "${sshd_config}"
  else
    echo "PasswordAuthentication no" | ${SUDO} tee -a "${sshd_config}" >/dev/null
  fi

  if grep -Eq '^[#[:space:]]*KbdInteractiveAuthentication' "${sshd_config}"; then
    ${SUDO} sed -i 's/^[#[:space:]]*KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' "${sshd_config}"
  else
    echo "KbdInteractiveAuthentication no" | ${SUDO} tee -a "${sshd_config}" >/dev/null
  fi

  ${SUDO} sshd -t
  ${SUDO} systemctl restart ssh
  log_success "SSH password authentication disabled. Verify key-based login before closing your session."
}

prepare_directories() {
  log_info "Creating deployment directories..."
  ${SUDO} install -d -m 0750 -o "${TARGET_USER}" -g "${TARGET_USER}" "${PROJECT_DIR}"
  ${SUDO} install -d -m 0750 -o "${TARGET_USER}" -g "${TARGET_USER}" "/backups/${APP_NAME}"
  log_success "Created ${PROJECT_DIR} and /backups/${APP_NAME}."
}

print_summary() {
  log_success "Server bootstrap complete."
  printf "\n"
  log_info "Project directory: ${PROJECT_DIR}"
  log_info "Backups directory: /backups/${APP_NAME}"
  log_info "Docker version: $(docker --version)"
  log_info "Docker Compose version: $(docker compose version)"

  if command -v node >/dev/null 2>&1; then
    log_info "Node.js version: $(node --version)"
  fi

  log_info "Git version: $(git --version)"
  log_info "UFW status: $(${SUDO} ufw status | head -n 1)"
  log_warning "If you were just added to the docker group, log out and back in or run: newgrp docker"
  log_warning "Make sure SSH keys are configured before disabling password authentication on any future run."
}

main() {
  install_base_packages
  configure_firewall
  install_docker
  install_node
  configure_ssh
  prepare_directories
  print_summary
}

main
