#!/usr/bin/env bash
# setup-flashmq.sh — Install, configure, and manage FlashMQ for testing.
#
# Usage:
#   bash scripts/setup-flashmq.sh
#   bash scripts/setup-flashmq.sh --tls
#   bash scripts/setup-flashmq.sh --tls-only
#   bash scripts/setup-flashmq.sh --stop
#   bash scripts/setup-flashmq.sh --status
#   bash scripts/setup-flashmq.sh --uninstall
#   bash scripts/setup-flashmq.sh --install-only
#   bash scripts/setup-flashmq.sh --clean-tls
#
# Supported: Ubuntu 22.04, 24.04

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

readonly FLASHMQ_VERSION="1.26.0"
readonly CONFIG_FILE="/etc/flashmq/flashmq.conf"
readonly LOG_DIR="/var/log/flashmq"
readonly STORAGE_DIR="/var/lib/flashmq"
readonly KEYRING="/usr/share/keyrings/flashmq-repo.gpg"
readonly APT_LIST="/etc/apt/sources.list.d/flashmq.list"
readonly REPO_KEY_URL="https://www.flashmq.org/wp-content/uploads/2021/10/flashmq-repo.gpg"
readonly REPO_URL="http://repo.flashmq.org/apt"

DISTRO=""

is_running() {
  pgrep -x flashmq >/dev/null 2>&1
}

detect_distro() {
  local codename
  codename="$(
    . /etc/os-release
    echo "${VERSION_CODENAME:-}"
  )"

  case "$codename" in
    jammy|noble) DISTRO="$codename" ;;
    *) die "Unsupported distro: ${codename:-unknown}. Supported: jammy, noble" ;;
  esac
}

install_flashmq() {
  title "Installing FlashMQ ${FLASHMQ_VERSION}"

  detect_distro
  info "Detected Ubuntu: $DISTRO"

  info "Downloading FlashMQ GPG key..."
  wget -q "$REPO_KEY_URL" -O /tmp/flashmq-repo.gpg
  sudo install -Dm644 /tmp/flashmq-repo.gpg "$KEYRING"

  info "Adding FlashMQ apt repository..."
  echo "deb [signed-by=$KEYRING] $REPO_URL $DISTRO main" \
    | sudo tee "$APT_LIST" >/dev/null

  info "Installing FlashMQ..."
  sudo apt-get update -qq || true

  if ! sudo apt-get install -y --allow-unauthenticated flashmq; then
    if have_cmd flashmq; then
      warn "dpkg post-install warning (systemd may be unavailable), but binary is installed."
    else
      die "FlashMQ installation failed."
    fi
  fi

  info "FlashMQ installed successfully."
}

configure_flashmq() {
  title "Configuring FlashMQ for testing"

  sudo mkdir -p "$LOG_DIR" "$STORAGE_DIR"
  sudo chmod -R 777 "$LOG_DIR" "$STORAGE_DIR"

  local tcp_port_block=""
  local tls_block=""

  if (( TLS_ONLY == 0 )); then
    tcp_port_block='listen {
  protocol mqtt
  inet_protocol ip4
  port 1883
}'
  fi

  if (( ENABLE_TLS == 1 )); then
    generate_tls_certs
    tls_block=$(cat <<EOF
listen {
  protocol mqtt
  inet_protocol ip4
  port 8883
  fullchain $TLS_SERVER_CERT
  privkey $TLS_SERVER_KEY
}
EOF
)
  fi

  sudo tee "$CONFIG_FILE" >/dev/null <<EOF
log_file $LOG_DIR/flashmq.log
storage_dir $STORAGE_DIR
allow_anonymous true

max_qos_msg_pending_per_client 1000
max_qos_bytes_pending_per_client 10485760

$tcp_port_block

$tls_block
EOF

  info "Configuration written to $CONFIG_FILE"
}

stop_flashmq() {
  title "Stopping FlashMQ"

  if ! is_running; then
    info "FlashMQ is not running."
    return 0
  fi

  pkill -x flashmq || true
  sleep 1
  info "FlashMQ stopped."
}

start_flashmq() {
  title "Starting FlashMQ"

  stop_flashmq >/dev/null 2>&1 || true

  flashmq &
  sleep 2

  is_running || die "Failed to start FlashMQ. Check logs: tail -20 $LOG_DIR/flashmq.log"

  if (( TLS_ONLY == 0 )); then
    ss -tlnp 2>/dev/null | grep -q ':1883 ' || warn "Port 1883 not detected yet"
  fi

  if (( ENABLE_TLS == 1 )); then
    ss -tlnp 2>/dev/null | grep -q ':8883 ' || warn "Port 8883 not detected yet"
  fi

  info "FlashMQ started (PID: $(pgrep -x flashmq | head -1))"
  flashmq --version
  echo

  if (( TLS_ONLY == 0 )); then
    info "MQTT endpoint:  mqtt://localhost:1883"
  fi
  if (( ENABLE_TLS == 1 )); then
    print_tls_summary
  fi
}

uninstall_flashmq() {
  title "Uninstalling FlashMQ"

  stop_flashmq >/dev/null 2>&1 || true
  sudo apt-get remove -y flashmq >/dev/null 2>&1 || true
  sudo rm -f "$APT_LIST" "$KEYRING"

  info "FlashMQ removed."
}

show_status() {
  title "FlashMQ Status"

  if is_running; then
    info "Status: RUNNING (PID: $(pgrep -x flashmq | head -1))"
    flashmq --version 2>/dev/null | head -1 || true
    info "Config: $CONFIG_FILE"
    info "Log:    $LOG_DIR/flashmq.log"
    ss -tlnp 2>/dev/null | grep -E '1883|8883' || true
  else
    info "Status: NOT RUNNING"
  fi
}

main() {
  parse_common_args "$@"

  case "$ACTION" in
    stop) stop_flashmq ;;
    status) show_status ;;
    uninstall) uninstall_flashmq ;;
    install-only) install_flashmq ;;
    clean-tls) remove_tls_certs ;;
    default)
      install_flashmq
      configure_flashmq
      start_flashmq
      echo
      title "Setup Complete"
      info "Run tests: npm run test:proto"
      info "Stop broker: bash scripts/setup-flashmq.sh --stop"
      ;;
  esac
}

main "$@"
