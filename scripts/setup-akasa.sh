#!/usr/bin/env bash
# setup-akasa.sh — Install, build, configure, and run Akasa MQTT broker.
#
# Usage:
#   bash scripts/setup-akasa.sh
#   bash scripts/setup-akasa.sh --tls
#   bash scripts/setup-akasa.sh --tls-only
#   bash scripts/setup-akasa.sh --stop
#   bash scripts/setup-akasa.sh --status
#   bash scripts/setup-akasa.sh --restart
#   bash scripts/setup-akasa.sh --clean-tls

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

readonly REPO_URL="https://github.com/akasamq/akasa.git"
readonly REPO_DIR="akasa"
readonly CONFIG_DIR="${REPO_DIR}/config"
readonly CONFIG_FILE="${CONFIG_DIR}/akasa.yaml"
readonly PASSWORD_FILE="${CONFIG_DIR}/passwords"
readonly LOG_FILE="${REPO_DIR}/akasa.log"
readonly PID_FILE="${REPO_DIR}/akasa.pid"
readonly BIN_PATH="${REPO_DIR}/target/release/akasa"

require_sudo() {
  sudo -v
}

install_system_deps() {
  title "Installing system dependencies"

  have_cmd apt-get || die "This script currently supports Debian/Ubuntu systems only."
  require_sudo

  sudo apt-get update -qq
  sudo apt-get install -y \
    curl \
    git \
    ca-certificates \
    build-essential \
    pkg-config \
    libssl-dev
}

install_rustup() {
  title "Installing Rust toolchain"

  if [[ -x "${HOME}/.cargo/bin/rustup" ]]; then
    info "rustup already installed."
  else
    info "Downloading and installing rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  fi

  source "${HOME}/.cargo/env"

  have_cmd rustc || die "rustc not found after rustup install"
  have_cmd cargo || die "cargo not found after rustup install"

  info "Rust:  $(rustc --version)"
  info "Cargo: $(cargo --version)"
}

clone_repo() {
  title "Cloning Akasa repository"

  if [[ -d "$REPO_DIR/.git" ]]; then
    info "Repository already exists, updating..."
    git -C "$REPO_DIR" fetch --all --tags
    git -C "$REPO_DIR" pull --ff-only
  else
    info "Cloning $REPO_URL ..."
    git clone "$REPO_URL" "$REPO_DIR"
  fi
}

build_akasa() {
  title "Building Akasa"

  # shellcheck disable=SC1090
  source "${HOME}/.cargo/env"

  pushd "$REPO_DIR" >/dev/null
  cargo build --release
  popd >/dev/null

  [[ -x "$BIN_PATH" ]] || die "Build succeeded but binary not found: $BIN_PATH"
  info "Binary: $BIN_PATH"
}

write_password_file() {
  title "Preparing password file"

  mkdir -p "$CONFIG_DIR"

  if [[ ! -f "$PASSWORD_FILE" ]]; then
    cat > "$PASSWORD_FILE" <<'EOF'
user:password
EOF
    info "Created password file: $PASSWORD_FILE"
  else
    info "Using existing password file: $PASSWORD_FILE"
  fi
}

write_config() {
  title "Writing Akasa config"

  mkdir -p "$CONFIG_DIR"

  local mqtt_block="mqtt: null"
  local mqtts_block="mqtts: null"

  if (( TLS_ONLY == 0 )); then
    mqtt_block=$(cat <<'EOF'
mqtt:
    addr: 127.0.0.1:1883
    reuse_port: true
    proxy_mode: null
EOF
)
  fi

  if (( ENABLE_TLS == 1 )); then
    generate_tls_certs
    mqtts_block=$(cat <<EOF
mqtts:
    addr: 127.0.0.1:8883
    reuse_port: true
    proxy: false
    ca_file: $TLS_CA_CERT
    key_file: $TLS_SERVER_KEY
    cert_file: $TLS_SERVER_CERT
    verify_peer: true
    fail_if_no_peer_cert: true
EOF
)
  fi

  cat > "$CONFIG_FILE" <<EOF
listeners:
  $mqtt_block
  $mqtts_block
  ws: null
  wss: null
  http: null
auth:
  enable: false
  password_file: null
scram_users:
  user:
    hashed_password: 2a2a2a
    iterations: 4096
    salt: 73616c74
sasl_mechanisms:
- SCRAM-SHA-256
check_v310_client_id_length: false
shared_subscription_mode: Random
max_allowed_qos: 2
inflight_timeout: 15
max_inflight_client: 10
max_inflight_server: 10
max_in_mem_pending_messages: 256
max_in_db_pending_messages: 65536
min_keep_alive: 10
max_keep_alive: 65535
multiple_subscription_id_in_publish: false
max_session_expiry_interval: 4294967295
max_packet_size_client: 268435460
max_packet_size_server: 268435460
topic_alias_max: 65535
retain_available: true
shared_subscription_available: true
subscription_id_available: true
wildcard_subscription_available: true
hook:
  enable_before_connect: true
  enable_after_connect: true
  enable_after_disconnect: true
  enable_publish: true
  enable_subscribe: true
  enable_unsubscribe: true
EOF

  info "Config written to: $CONFIG_FILE"
}

is_running() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
    return
  fi

  pgrep -f "${BIN_PATH} start --config ${CONFIG_FILE}" >/dev/null 2>&1
}

stop_akasa() {
  title "Stopping Akasa"

  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" || true
      sleep 1
      rm -f "$PID_FILE"
      info "Akasa stopped."
      return 0
    fi
    rm -f "$PID_FILE"
  fi

  if pgrep -f "${BIN_PATH} start --config ${CONFIG_FILE}" >/dev/null 2>&1; then
    pkill -f "${BIN_PATH} start --config ${CONFIG_FILE}" || true
    sleep 1
    info "Akasa stopped."
  else
    info "Akasa is not running."
  fi
}

start_akasa() {
  title "Starting Akasa"

  stop_akasa >/dev/null 2>&1 || true

  [[ -x "$BIN_PATH" ]] || die "Binary not found: $BIN_PATH"
  [[ -f "$CONFIG_FILE" ]] || die "Config not found: $CONFIG_FILE"

  nohup "$BIN_PATH" start --config "$CONFIG_FILE" >"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 2

  is_running || die "Failed to start Akasa. Check log: tail -50 $LOG_FILE"

  if (( TLS_ONLY == 0 )); then
    ss -tlnp 2>/dev/null | grep -q ':1883 ' || warn "Port 1883 not detected yet"
  fi

  if (( ENABLE_TLS == 1 )); then
    ss -tlnp 2>/dev/null | grep -q ':8883 ' || warn "Port 8883 not detected yet"
  fi

  info "Akasa started (PID: $(cat "$PID_FILE"))"

  if (( TLS_ONLY == 0 )); then
    info "MQTT endpoint:  mqtt://127.0.0.1:1883"
  fi

  if (( ENABLE_TLS == 1 )); then
    print_tls_summary
  fi

  info "Config: $CONFIG_FILE"
  info "Log:    $LOG_FILE"
}

show_status() {
  title "Akasa Status"

  if is_running; then
    info "Status: RUNNING"
    info "PID: $(cat "$PID_FILE" 2>/dev/null || pgrep -f "${BIN_PATH} start --config ${CONFIG_FILE}" | head -1)"
    info "Binary: $BIN_PATH"
    info "Config: $CONFIG_FILE"
    info "Log:    $LOG_FILE"
    ss -tlnp 2>/dev/null | grep -E '1883|8883' || true
  else
    info "Status: NOT RUNNING"
  fi
}

setup_all() {
  install_system_deps
  install_rustup
  clone_repo
  build_akasa
  write_password_file
  write_config
  start_akasa

  echo
  title "Setup Complete"
  info "Binary: $BIN_PATH"
  info "Config: $CONFIG_FILE"
  info "Status: bash scripts/setup-akasa.sh --status"
  info "Stop:   bash scripts/setup-akasa.sh --stop"
}

main() {
  parse_common_args "$@"

  case "$ACTION" in
    stop)
      stop_akasa
      ;;
    status)
      show_status
      ;;
    uninstall)
      die "Uninstall action is not implemented for Akasa. Remove the '$REPO_DIR' directory manually if needed."
      ;;
    install-only)
      install_system_deps
      install_rustup
      clone_repo
      build_akasa
      write_password_file
      write_config
      ;;
    clean-tls)
      remove_tls_certs
      ;;
    default)
      setup_all
      ;;
    *)
      die "Unsupported action: $ACTION"
      ;;
  esac
}

main "$@"
