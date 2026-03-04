#!/usr/bin/env bash

set -euo pipefail

readonly TLS_DIR="/etc/mqtt-certs"
readonly TLS_CA_KEY="$TLS_DIR/ca.key"
readonly TLS_CA_CERT="$TLS_DIR/ca.crt"
readonly TLS_CA_SERIAL="$TLS_DIR/ca.srl"
readonly TLS_SERVER_KEY="$TLS_DIR/server.key"
readonly TLS_SERVER_CSR="$TLS_DIR/server.csr"
readonly TLS_SERVER_CERT="$TLS_DIR/server.crt"
readonly TLS_SERVER_EXT="$TLS_DIR/server.ext"

title() {
  printf '\n═══ %s ═══\n' "$1"
}

info() {
  printf '  %s\n' "$1"
}

warn() {
  printf '  ⚠ %s\n' "$1"
}

die() {
  printf '  ✘ %s\n' "$1" >&2
  exit 1
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

ensure_openssl() {
  have_cmd openssl || die "openssl is required"
}

ensure_tls_dir() {
  sudo mkdir -p "$TLS_DIR"
  sudo chmod 755 "$TLS_DIR"
}

generate_tls_certs() {
  title "Generating TLS certificates"

  ensure_openssl
  ensure_tls_dir

  if [[ -f "$TLS_CA_CERT" && -f "$TLS_SERVER_CERT" && -f "$TLS_SERVER_KEY" ]]; then
    info "Using existing certificates in $TLS_DIR"
    return 0
  fi

  info "Generating CA certificate..."
  sudo openssl req -x509 -nodes -newkey rsa:2048 \
    -days 3650 \
    -subj "/CN=MQTT Test CA" \
    -keyout "$TLS_CA_KEY" \
    -out "$TLS_CA_CERT" \
    >/dev/null 2>&1

  info "Generating server key and CSR..."
  sudo openssl req -nodes -newkey rsa:2048 \
    -subj "/CN=localhost" \
    -keyout "$TLS_SERVER_KEY" \
    -out "$TLS_SERVER_CSR" \
    >/dev/null 2>&1

  info "Writing SAN extension file..."
  sudo tee "$TLS_SERVER_EXT" >/dev/null <<'EOF'
subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1
extendedKeyUsage=serverAuth
keyUsage=digitalSignature,keyEncipherment
EOF

  info "Signing server certificate..."
  sudo openssl x509 -req \
    -in "$TLS_SERVER_CSR" \
    -CA "$TLS_CA_CERT" \
    -CAkey "$TLS_CA_KEY" \
    -CAcreateserial \
    -out "$TLS_SERVER_CERT" \
    -days 3650 \
    -extfile "$TLS_SERVER_EXT" \
    >/dev/null 2>&1

  sudo chmod 644 "$TLS_CA_CERT" "$TLS_SERVER_CERT"
  sudo chmod 600 "$TLS_CA_KEY" "$TLS_SERVER_KEY"

  info "Certificates generated in $TLS_DIR"
}

remove_tls_certs() {
  title "Removing TLS certificates"
  sudo rm -rf "$TLS_DIR"
  info "Removed $TLS_DIR"
}

print_tls_summary() {
  info "TLS CA cert:     $TLS_CA_CERT"
  info "TLS server cert: $TLS_SERVER_CERT"
  info "TLS server key:  $TLS_SERVER_KEY"
  info "TLS endpoint:    mqtts://localhost:8883"
}

parse_common_args() {
  ACTION="default"
  ENABLE_TLS=0
  TLS_ONLY=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tls)
        ENABLE_TLS=1
        ;;
      --tls-only)
        ENABLE_TLS=1
        TLS_ONLY=1
        ;;
      --stop|--status|--uninstall|--install-only|--clean-tls)
        ACTION="${1#--}"
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
    shift
  done
}
