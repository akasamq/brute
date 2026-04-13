#!/usr/bin/env bash
# test-akasa.sh - Setup Akasa broker and run paho MQTT interoperability tests (v5 + v3).

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly SETUP_SCRIPT="${SCRIPT_DIR}/setup-akasa.sh"
readonly TEST_DIR="${REPO_ROOT}/paho.mqtt.testing/interoperability"

PYTHON_BIN="${PYTHON_BIN:-python3}"
readonly V5_TEST_SCRIPT="client_test5.py"
readonly V3_TEST_SCRIPT="client_test.py"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/test-akasa.sh [options]

Options:
  -h, --help         Show this help

Examples:
  bash scripts/test-akasa.sh
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      shift
      exit 1
      ;;
  esac
done

if [[ ! -x "$SETUP_SCRIPT" ]]; then
  echo "Setup script not found or not executable: $SETUP_SCRIPT" >&2
  exit 1
fi

if [[ ! -d "$TEST_DIR" ]]; then
  echo "Test directory not found: $TEST_DIR" >&2
  echo "Did you initialize submodule? Try: git submodule update --init --recursive" >&2
  exit 1
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python binary not found: $PYTHON_BIN" >&2
  exit 1
fi

cleanup() {
  bash "$SETUP_SCRIPT" --stop || true
}

trap cleanup EXIT

echo "==> Setting up Akasa broker..."
bash "$SETUP_SCRIPT"

if [[ ! -f "${TEST_DIR}/${V5_TEST_SCRIPT}" ]]; then
  echo "Python test script not found: ${TEST_DIR}/${V5_TEST_SCRIPT}" >&2
  exit 1
fi

if [[ ! -f "${TEST_DIR}/${V3_TEST_SCRIPT}" ]]; then
  echo "Python test script not found: ${TEST_DIR}/${V3_TEST_SCRIPT}" >&2
  exit 1
fi

echo "==> Running MQTT v5 compatibility test: ${V5_TEST_SCRIPT}"

cd "$TEST_DIR"
v5_rc=0
v3_rc=0

"$PYTHON_BIN" "$V5_TEST_SCRIPT" || v5_rc=$?

echo "==> Running MQTT v3 compatibility test: ${V3_TEST_SCRIPT}"
"$PYTHON_BIN" "$V3_TEST_SCRIPT" || v3_rc=$?

if (( v5_rc != 0 || v3_rc != 0 )); then
  echo "==> Compatibility test failed (v5=${v5_rc}, v3=${v3_rc})" >&2
  exit 1
fi
