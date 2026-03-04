#!/usr/bin/env bash
# setup-emqx.sh — Install, configure, and manage EMQX for testing.
#
# Usage:
#   bash scripts/setup-emqx.sh
#   bash scripts/setup-emqx.sh --tls
#   bash scripts/setup-emqx.sh --tls-only
#   bash scripts/setup-emqx.sh --stop
#   bash scripts/setup-emqx.sh --status
#   bash scripts/setup-emqx.sh --uninstall
#   bash scripts/setup-emqx.sh --install-only
#   bash scripts/setup-emqx.sh --clean-tls
#
# Supported: Ubuntu 22.04, 24.04

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

readonly EMQX_VERSION="6.2.0"
readonly EMQX_CONFIG="/etc/emqx/emqx.conf"

UBUNTU_VERSION=""
ARCH=""
EMQX_DEB=""
EMQX_DEB_PATH=""
EMQX_DEB_URL=""

is_running() {
  ss -tlnp 2>/dev/null | grep -Eq ':(1883|8883)\s'
}

detect_platform() {
  title "Detecting platform"

  local os_id version_id

  os_id="$(
    . /etc/os-release
    echo "${ID:-}"
  )"

  version_id="$(
    . /etc/os-release
    echo "${VERSION_ID:-}"
  )"

  ARCH="$(dpkg --print-architecture)"

  [[ "$os_id" == "ubuntu" ]] || die "Unsupported OS: ${os_id:-unknown}. Ubuntu only."

  case "$version_id" in
    "22.04"|"24.04")
      UBUNTU_VERSION="$version_id"
      ;;
    *)
      die "Unsupported Ubuntu version: ${version_id:-unknown}. Supported: 22.04, 24.04"
      ;;
  esac

  case "$ARCH" in
    amd64|arm64)
      ;;
    *)
      die "Unsupported architecture: $ARCH. Supported: amd64, arm64"
      ;;
  esac

  EMQX_DEB="emqx-enterprise-${EMQX_VERSION}-ubuntu${UBUNTU_VERSION}-${ARCH}.deb"
  EMQX_DEB_PATH="/tmp/${EMQX_DEB}"
  EMQX_DEB_URL="https://www.emqx.com/en/downloads/enterprise/${EMQX_VERSION}/${EMQX_DEB}"

  info "Ubuntu: $UBUNTU_VERSION"
  info "Arch:   $ARCH"
  info "Package: $EMQX_DEB"
}

install_emqx() {
  title "Installing EMQX ${EMQX_VERSION}"

  detect_platform

  if [[ -f "$EMQX_DEB_PATH" ]]; then
    info "Using cached $EMQX_DEB_PATH"
  else
    info "Downloading $EMQX_DEB..."
    wget -q "$EMQX_DEB_URL" -O "$EMQX_DEB_PATH" \
      || die "Failed to download package: $EMQX_DEB_URL"
  fi

  info "Installing EMQX..."
  if ! sudo apt-get install -y "$EMQX_DEB_PATH"; then
    if dpkg -l emqx-enterprise 2>/dev/null | grep -q '^ii'; then
      warn "dpkg post-install warning (systemd may be unavailable), but EMQX is installed."
    else
      die "EMQX installation failed."
    fi
  fi

  info "EMQX installed successfully."
}

configure_emqx() {
  title "Configuring EMQX for testing"

  local tcp_block=""
  local tls_block=""

  if (( TLS_ONLY == 0 )); then
    tcp_block=$(cat <<'EOF'
listeners.tcp.default {
  bind = "0.0.0.0:1883"
}
EOF
)
  fi

  if (( ENABLE_TLS == 1 )); then
    generate_tls_certs
    tls_block=$(cat <<EOF
listeners.ssl.default {
  bind = "0.0.0.0:8883"
  ssl_options {
    certfile = "$TLS_SERVER_CERT"
    keyfile = "$TLS_SERVER_KEY"
    cacertfile = "$TLS_CA_CERT"
    verify = verify_none
    fail_if_no_peer_cert = false
  }
}
EOF
)
  fi

  sudo tee "$EMQX_CONFIG" >/dev/null <<EOF
## EMQX configuration for testing
node {
  name = "emqx@127.0.0.1"
  cookie = "emqx50elixir"
  data_dir = "/var/lib/emqx"
}

cluster {
  name = emqxcl
  discovery_strategy = manual
}

dashboard {
  listeners.http.bind = 18083
}

$tcp_block

$tls_block
EOF

  sudo rm -rf /var/lib/emqx/mnesia/* /var/log/emqx/*
  info "EMQX configured."
}

stop_emqx() {
  title "Stopping EMQX"

  if ! is_running; then
    info "EMQX is not running."
    return 0
  fi

  sudo pkill -x beam.smp 2>/dev/null || true
  sudo pkill -x emqx 2>/dev/null || true
  sudo pkill -x erl 2>/dev/null || true
  sudo pkill -x su 2>/dev/null || true
  sleep 2
  info "EMQX stopped."
}

start_emqx() {
  title "Starting EMQX"

  stop_emqx >/dev/null 2>&1 || true

  info "Starting EMQX..."
  nohup sudo emqx foreground >/dev/null 2>&1 &

  local max_wait=60
  local waited=0
  local interval=3

  while (( waited < max_wait )); do
    sleep $interval
    waited=$((waited + interval))

    local port_ok=true
    if (( TLS_ONLY == 0 )); then
      ss -tlnp 2>/dev/null | grep -q ':1883 ' || port_ok=false
    fi
    if (( ENABLE_TLS == 1 )); then
      ss -tlnp 2>/dev/null | grep -q ':8883 ' || port_ok=false
    fi

    if $port_ok; then
      break
    fi
    info "Waiting for EMQX to start... (${waited}s)"
  done

  if (( TLS_ONLY == 0 )); then
    ss -tlnp 2>/dev/null | grep -q ':1883 ' || die "Failed to start EMQX on port 1883 after ${max_wait}s"
  fi

  if (( ENABLE_TLS == 1 )); then
    ss -tlnp 2>/dev/null | grep -q ':8883 ' || die "Failed to start EMQX TLS listener on port 8883 after ${max_wait}s"
  fi

  info "EMQX started successfully."
  echo

  if (( TLS_ONLY == 0 )); then
    info "MQTT endpoint:  mqtt://localhost:1883"
  fi
  if (( ENABLE_TLS == 1 )); then
    print_tls_summary
  fi
}

uninstall_emqx() {
  title "Uninstalling EMQX"

  detect_platform || true
  stop_emqx >/dev/null 2>&1 || true
  sudo apt-get remove --purge -y emqx-enterprise >/dev/null 2>&1 || true
  sudo apt-get autoremove -y >/dev/null 2>&1 || true

  [[ -n "${EMQX_DEB_PATH:-}" ]] && rm -f "$EMQX_DEB_PATH"

  info "EMQX removed."
}

show_status() {
  title "EMQX Status"

  if is_running; then
    info "Status: RUNNING"
    info "Version: $EMQX_VERSION"
    ss -tlnp 2>/dev/null | grep -E '1883|8883' || true
  else
    info "Status: NOT RUNNING"
  fi
}

main() {
  parse_common_args "$@"

  case "$ACTION" in
    stop) stop_emqx ;;
    status) show_status ;;
    uninstall) uninstall_emqx ;;
    install-only) install_emqx ;;
    clean-tls) remove_tls_certs ;;
    default)
      install_emqx
      configure_emqx
      start_emqx
      echo
      title "Setup Complete"
      info "Run tests: npm run test:proto"
      info "Stop broker: bash scripts/setup-emqx.sh --stop"
      ;;
  esac
}

main "$@"
