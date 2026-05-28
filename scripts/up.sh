#!/usr/bin/env bash
# Cenote — bring the stack up under Docker or Podman, transparently.
#
# Detection priority: docker compose → podman compose → podman-compose.
# Pass any extra args through (e.g. -d, --build).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<EOF
Usage: scripts/up.sh [action] [extra args]

Actions:
  up [-d] [--build]      start the stack (default if omitted)
  down                   stop and remove containers
  build                  rebuild images
  logs [-f] [service]    show logs
  ps                     list running services
  restart [service]      restart a service
  stop / start / kill    container lifecycle
  config                 show resolved compose config

Examples:
  scripts/up.sh                    # equivalent to: up --build
  scripts/up.sh up                 # start (auto-adds --build first time)
  scripts/up.sh up -d              # detached
  scripts/up.sh down               # stop
  scripts/up.sh logs -f api        # tail api logs
  scripts/up.sh build              # rebuild only

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
    # podman v4+ delegates to whatever compose provider it finds. If only
    # `podman-compose` is installed, podman will use it but pass args through
    # — we need to invoke it directly to avoid double-translation issues.
    if ! podman compose version 2>&1 | grep -qi "docker compose"; then
      # podman is delegating to podman-compose under the hood — call it directly
      if command -v podman-compose >/dev/null 2>&1; then
        echo "podman-compose"
        return
      fi
    fi
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
  echo "install one of:" >&2
  echo "  - Docker:           https://docs.docker.com/get-docker/" >&2
  echo "  - Podman:           https://podman.io/getting-started/installation" >&2
  echo "  - podman-compose:   pip install podman-compose" >&2
  exit 1
fi

# Whitelist of valid actions. Anything else (especially starting with `-`)
# means the user skipped the action and went straight to flags → default to `up`.
VALID_ACTIONS=" up down build logs ps restart start stop kill config exec run pull push images version help "

if [[ $# -eq 0 ]]; then
  ACTION="up"
elif [[ "$1" == -* ]]; then
  # First arg is a flag (e.g. `--build`, `-d`) → user meant `up <flags>`
  ACTION="up"
elif [[ "$VALID_ACTIONS" != *" $1 "* ]]; then
  # First arg is a word but not a known action → pass through as-is, let
  # the compose tool report the error.
  ACTION="$1"
  shift
else
  ACTION="$1"
  shift
fi

# For `up`, default to including --build the first time so images stay fresh.
if [[ "$ACTION" == "up" && "$*" != *"--build"* && "$*" != *"--no-build"* ]]; then
  set -- --build "$@"
fi

# Compute COMMIT_HASH from the host once so the web container shows the right
# build identifier without needing git inside the container.
if [[ -z "${COMMIT_HASH:-}" ]]; then
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    COMMIT_HASH=$(git rev-parse --short=4 HEAD 2>/dev/null || echo "????")
  else
    COMMIT_HASH="????"
  fi
fi
export COMMIT_HASH

echo "→ runtime: $CMD"
echo "→ commit:  $COMMIT_HASH"
echo "→ action:  $ACTION ${*:-}"
echo

# shellcheck disable=SC2086
exec $CMD $ACTION "$@"
