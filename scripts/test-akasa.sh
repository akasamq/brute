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
  --host HOST        MQTT broker hostname (default: localhost)
  --port PORT        MQTT broker port (default: 1883)
  --timeout SECONDS  Timeout per test (default: 120)

Environment:
  PYTHON_BIN         Python binary (default: python3)

Examples:
  bash scripts/test-akasa.sh
  bash scripts/test-akasa.sh --host 127.0.0.1 --timeout 60
EOF
}

HOST="localhost"
PORT=1883
TEST_TIMEOUT=120

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --host)
      HOST="$2"; shift 2
      ;;
    --port)
      PORT="$2"; shift 2
      ;;
    --timeout)
      TEST_TIMEOUT="$2"; shift 2
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

TEST_RUNNER="${SCRIPT_DIR}/test.py"

cleanup() {
  bash "$SETUP_SCRIPT" --stop || true
}

trap cleanup EXIT

echo "==> Setting up Akasa broker..."
bash "$SETUP_SCRIPT"

if [[ ! -f "$TEST_RUNNER" ]]; then
  echo "Test runner not found: $TEST_RUNNER" >&2
  exit 1
fi

echo "==> Running MQTT compatibility tests (v5 + v3)..."
echo ""

"$PYTHON_BIN" "$TEST_RUNNER" --host "$HOST" --port "$PORT" --timeout "$TEST_TIMEOUT" || exit $?
