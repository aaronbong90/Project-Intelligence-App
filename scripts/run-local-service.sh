#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

APP_DIR="/Users/aaronbongxianzhi/Documents/Playground/apps/project-field-hub-next"
LOG_DIR="$APP_DIR/.runtime"

mkdir -p "$LOG_DIR"

cd "$APP_DIR"

exec npm run dev:local >> "$LOG_DIR/server.log" 2>&1
