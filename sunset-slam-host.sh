#!/bin/bash
# SUNSET SLAM — one-click match host.
# Starts the game server (if not already running) and opens the host page
# with the link to send to Laki.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$DIR/.server.log"
URL="http://127.0.0.1:4173/host"


server_up() {
  curl -s -o /dev/null --max-time 2 http://127.0.0.1:4173/api/status
}

if server_up; then
  echo "Sunset Slam is already running."
else
  # Build once if the bundle is missing.
  if [ ! -f "$DIR/dist/index.html" ]; then
    echo "First run: building the game (one minute)…"
    (cd "$DIR" && npm run build >> "$LOG" 2>&1)
  fi
  echo "Starting Sunset Slam…"
  cd "$DIR" || exit 1
  nohup node server.mjs >> "$LOG" 2>&1 &
  disown
  for i in $(seq 1 30); do
    server_up && break
    sleep 0.5
  done
fi

if server_up; then
  echo "Server is up. Opening the host page…"
  if [ "${SUNSET_SLAM_NO_OPEN:-0}" != "1" ]; then
    (xdg-open "$URL" >/dev/null 2>&1 &) || true
  fi
  echo "Send Laki this link:  $(curl -s http://127.0.0.1:4173/api/status | grep -o '"addresses":\[[^]]*\]' | head -c 200)"
  echo "(the full link is on the host page that just opened)"
else
  echo "Could not start the server — check $LOG"
  exit 1
fi
