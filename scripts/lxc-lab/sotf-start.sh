#!/bin/bash
set -e
cd /data 2>/dev/null || cd /home/container
export WINEPREFIX="${WINEPREFIX:-$PWD/.wine}"
export WINEDLLOVERRIDES="${WINEDLLOVERRIDES:-mscoree,mshtml=}"
export WINEARCH="${WINEARCH:-win64}"
export DISPLAY="${DISPLAY:-:0.0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-container}"
mkdir -p "$XDG_RUNTIME_DIR" "$WINEPREFIX"
chmod 700 "$XDG_RUNTIME_DIR"
if ! pgrep -x Xvfb >/dev/null 2>&1; then
  Xvfb :0 -screen 0 1024x768x16 -ac +extension GLX +render -noreset >/tmp/xvfb.log 2>&1 &
  sleep 1
fi
exec /opt/wine-stable/bin/wine ./SonsOfTheForestDS.exe \
  -userdatapath "$PWD/serverconfig" \
  -dedicatedserver.IpAddress 0.0.0.0 \
  -dedicatedserver.GamePort "${SERVER_PORT:-8766}" \
  -dedicatedserver.QueryPort "${QUERY_PORT:-27016}" \
  -dedicatedserver.BlobSyncPort "${BLOBSYNC_PORT:-9700}" \
  -dedicatedserver.MaxPlayers "${MAX_PLAYERS:-4}" \
  -dedicatedserver.Password "${SRV_PW:-changeme}" \
  -dedicatedserver.GameMode "${GAME_MODE:-normal}" \
  -dedicatedserver.SkipNetworkAccessibilityTest "${SKIP_TESTS:-true}" \
  -dedicatedserver.SaveSlot "${SAVE_SLOT:-0000000001}" \
  -dedicatedserver.LogFilesEnabled true \
  -dedicatedserver.TimestampLogFilenames true
