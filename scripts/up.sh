#!/usr/bin/env bash
# Cenote — bring the stack up under Docker or Podman, transparently.
#
# Detection priority: docker compose → podman compose → podman-compose.
# Pass any extra args through (e.g. -d, --build).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<EOF
Usage: scripts/up.sh [up|down|build|logs|...] [extra args]

Examples:
  scripts/up.sh up --build
  scripts/up.sh up -d
  scripts/up.sh logs -f api
  scripts/up.sh down

Runtime detection:
  1. docker compose      (Docker Engine v2 plugin)
  2. podman compose      (Podman v4+ built-in)
  3. podman-compose      (standalone Python implementation)
EOF
  exit 0
fi

detect() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return
  fi
  if command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
    echo "podman compose"
    return
  fi
  if command -v podman-compose >/dev/null 2>&1; then
    echo "podman-compose"
    return
  fi
  echo ""
}

CMD="$(detect)"
if [[ -z "$CMD" ]]; then
  echo "error: neither docker compose, podman compose, nor podman-compose found in PATH" >&2
  echo "install one of: https://docs.docker.com/get-docker/ or https://podman.io/getting-started/installation" >&2
  exit 1
fi

ACTION="${1:-up}"; shift || true

echo "→ using: $CMD"
echo "→ action: $ACTION $*"
echo

# Default to --build on first up if /data volume doesn't exist
if [[ "$ACTION" == "up" && "$*" != *"--build"* ]]; then
  set -- --build "$@"
fi

# shellcheck disable=SC2086
exec $CMD $ACTION "$@"
