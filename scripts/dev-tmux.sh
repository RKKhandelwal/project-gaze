#!/usr/bin/env bash

set -euo pipefail

SESSION_NAME="${1:-gaze-dev}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed. Install it first (e.g. brew install tmux)."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required but not found on PATH."
  exit 1
fi

if [ ! -f "${ROOT_DIR}/package.json" ]; then
  echo "Could not find package.json at ${ROOT_DIR}"
  exit 1
fi

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "tmux session '${SESSION_NAME}' already exists."
  echo "Attach with: tmux attach -t ${SESSION_NAME}"
  exit 0
fi

echo "Starting tmux session '${SESSION_NAME}' from ${ROOT_DIR}"

# Create detached session with first window: server
tmux new-session -d -s "${SESSION_NAME}" -c "${ROOT_DIR}" -n "server"
tmux send-keys -t "${SESSION_NAME}:server" "echo 'Starting server...'" C-m
tmux send-keys -t "${SESSION_NAME}:server" "pnpm run dev:server" C-m

# Create second window: mobile
tmux new-window -t "${SESSION_NAME}" -c "${ROOT_DIR}" -n "mobile"
tmux send-keys -t "${SESSION_NAME}:mobile" "echo 'Starting mobile...'" C-m
tmux send-keys -t "${SESSION_NAME}:mobile" "pnpm run start:mobile" C-m

# Focus server window initially
tmux select-window -t "${SESSION_NAME}:server"

cat <<EOF
Session '${SESSION_NAME}' is ready with two windows:
  1) server  -> pnpm run dev:server
  2) mobile  -> pnpm run start:mobile

Attach:
  tmux attach -t ${SESSION_NAME}

Useful tmux keys:
  Ctrl-b n   next window
  Ctrl-b p   previous window
  Ctrl-b w   list/select windows
  Ctrl-b d   detach

To stop everything:
  tmux kill-session -t ${SESSION_NAME}
EOF

if [ -t 0 ] && [ -t 1 ]; then
  tmux attach -t "${SESSION_NAME}"
else
  echo "Non-interactive shell detected; skipping auto-attach."
  echo "Attach manually with: tmux attach -t ${SESSION_NAME}"
fi
