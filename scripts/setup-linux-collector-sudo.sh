#!/usr/bin/env bash

set -euo pipefail

SHOW_ONLY=0
APPLY_SYSCTL=0
TARGET_USER="${SUDO_USER:-${USER:-}}"
SUDOERS_NAME="mini-drop-collectors"
SUDOERS_DIR="/etc/sudoers.d"
PERF_EVENT_VALUE="${MINI_DROP_PERF_EVENT_PARANOID:-1}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/setup-linux-collector-sudo.sh [--user <linux-user>] [--print-only] [--apply-sysctl]

What it does:
  - Detects collector binaries currently available on this Linux host.
  - Generates a minimal sudoers rule for perf / bpftrace / async-profiler helper binaries when found.
  - Prints the exact rule, or installs it into /etc/sudoers.d/mini-drop-collectors.
  - Optionally lowers kernel.perf_event_paranoid for perf-based collection.

Examples:
  bash scripts/setup-linux-collector-sudo.sh --user admin
  bash scripts/setup-linux-collector-sudo.sh --user admin --print-only
  bash scripts/setup-linux-collector-sudo.sh --user admin --apply-sysctl
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      TARGET_USER="${2:-}"
      shift 2
      ;;
    --print-only)
      SHOW_ONLY=1
      shift
      ;;
    --apply-sysctl)
      APPLY_SYSCTL=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${TARGET_USER}" ]]; then
  echo "Unable to determine target Linux user. Pass --user <linux-user>." >&2
  exit 1
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This setup script only supports Linux hosts." >&2
  exit 1
fi

declare -a COMMANDS=()

append_if_exists() {
  local candidate="$1"
  if [[ -x "$candidate" ]]; then
    COMMANDS+=("$candidate")
  fi
}

if command -v perf >/dev/null 2>&1; then
  append_if_exists "$(command -v perf)"
fi
if command -v bpftrace >/dev/null 2>&1; then
  append_if_exists "$(command -v bpftrace)"
fi

append_if_exists "/opt/async-profiler/profiler.sh"
append_if_exists "/usr/local/bin/async-profiler"
append_if_exists "/usr/bin/async-profiler"

if [[ ${#COMMANDS[@]} -eq 0 ]]; then
  echo "No supported collector binaries were found. Expected at least perf or bpftrace." >&2
  exit 1
fi

declare -A SEEN=()
declare -a UNIQUE_COMMANDS=()
for command_path in "${COMMANDS[@]}"; do
  if [[ -z "${SEEN[$command_path]+x}" ]]; then
    UNIQUE_COMMANDS+=("$command_path")
    SEEN["$command_path"]=1
  fi
done

COMMAND_LIST="$(printf '%s, ' "${UNIQUE_COMMANDS[@]}")"
COMMAND_LIST="${COMMAND_LIST%, }"

SUDOERS_CONTENT="# Mini-Drop collector privilege path\n${TARGET_USER} ALL=(root) NOPASSWD: ${COMMAND_LIST}\n"

echo "Detected collector commands for ${TARGET_USER}:"
for command_path in "${UNIQUE_COMMANDS[@]}"; do
  echo "  - ${command_path}"
done
echo
echo "Proposed sudoers rule:"
printf '%b' "${SUDOERS_CONTENT}"
echo

if [[ "${SHOW_ONLY}" -eq 1 ]]; then
  echo "print-only mode: no system files were changed."
  exit 0
fi

TMP_FILE="$(mktemp)"
trap 'rm -f "${TMP_FILE}"' EXIT
printf '%b' "${SUDOERS_CONTENT}" > "${TMP_FILE}"
chmod 0440 "${TMP_FILE}"

echo "Installing sudoers rule into ${SUDOERS_DIR}/${SUDOERS_NAME} ..."
sudo install -o root -g root -m 0440 "${TMP_FILE}" "${SUDOERS_DIR}/${SUDOERS_NAME}"
sudo visudo -cf "${SUDOERS_DIR}/${SUDOERS_NAME}"

if [[ "${APPLY_SYSCTL}" -eq 1 ]]; then
  echo "Applying kernel.perf_event_paranoid=${PERF_EVENT_VALUE} ..."
  sudo sysctl -w "kernel.perf_event_paranoid=${PERF_EVENT_VALUE}"
  printf 'kernel.perf_event_paranoid=%s\n' "${PERF_EVENT_VALUE}" | sudo tee /etc/sysctl.d/99-mini-drop-perf.conf >/dev/null
fi

echo
echo "Mini-Drop Linux collector privilege setup completed."
echo "Verification commands:"
echo "  sudo -n perf --version"
if command -v bpftrace >/dev/null 2>&1; then
  echo "  sudo -n bpftrace --version"
fi
echo "  cat /proc/sys/kernel/perf_event_paranoid"
