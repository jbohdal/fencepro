#!/bin/bash
# Install the two launch agents for the Mac install. Both start when you log
# in (FileVault keeps the disk locked until then). Safe to run again.
#
#   com.ezbiz.pm2      brings back the saved pm2 process list (the server)
#   com.ezbiz.backup   runs deploy/mac/backup.sh every night at 2:30
#   com.ezbiz.nightly  (opt in) the nightly safety net, deploy/mac/nightly-check.sh
#                      at 19:15, from the WORKING FOLDER (never ~/ezbiz). Installed
#                      only when EZBIZ_NIGHTLY_DIR names that folder:
#                        EZBIZ_NIGHTLY_DIR="$HOME/Downloads/ALL MY SHIT/project for vs code/ez-biz-final" \
#                          bash ~/ezbiz/deploy/mac/install-launch-agents.sh
#                      Add --nightly-only to leave the other two as they are.
#                      EZBIZ_NIGHTLY_DIR=off removes it. GO_LIVE.md, section 20.
#
# Postgres has its own agent from: brew services start postgresql@16
set -euo pipefail

LIVE="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/ezbiz"
PM2_BIN="$(command -v pm2 || true)"
mkdir -p "$AGENTS" "$LOGS"

# --nightly-only: only the nightly check below (the server and backup agents are left as they are).
if [ "${1:-}" != "--nightly-only" ]; then

cat > "$AGENTS/com.ezbiz.pm2.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.ezbiz.pm2</string>
  <key>ProgramArguments</key><array><string>$PM2_BIN</string><string>resurrect</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PM2_HOME</key><string>$HOME/.pm2</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>$LOGS/pm2-start.log</string>
  <key>StandardErrorPath</key><string>$LOGS/pm2-start.log</string>
</dict></plist>
PLIST

cat > "$AGENTS/com.ezbiz.backup.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.ezbiz.backup</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$LIVE/deploy/mac/backup.sh</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>EZBIZ_BACKUP_DIR</key><string>$HOME/ezbiz-backups</string>
    <key>EZBIZ_BACKUP_COPY_DIR</key><string>${EZBIZ_BACKUP_COPY_DIR:-}</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$LOGS/backup.log</string>
  <key>StandardErrorPath</key><string>$LOGS/backup.log</string>
</dict></plist>
PLIST

for label in com.ezbiz.pm2 com.ezbiz.backup; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"
done

fi

# The nightly check (opt in). It runs the working folder's copy of the code on the dev
# database, so it is pointed at the working folder, never at this live install.
NIGHTLY="${EZBIZ_NIGHTLY_DIR:-}"
if [ "$NIGHTLY" = "off" ]; then
  launchctl bootout "gui/$(id -u)/com.ezbiz.nightly" 2>/dev/null || true
  rm -f "$AGENTS/com.ezbiz.nightly.plist"
  echo "The nightly check is removed."
elif [ -n "$NIGHTLY" ]; then
  NIGHTLY="$(cd "$NIGHTLY" && pwd)"
  case "$NIGHTLY/" in "$LIVE/"*|"$HOME/ezbiz/"*) echo "Refusing: EZBIZ_NIGHTLY_DIR must be the working folder, not the live install ($NIGHTLY)." >&2; exit 1 ;; esac
  [ -f "$NIGHTLY/deploy/mac/nightly-check.sh" ] || { echo "No deploy/mac/nightly-check.sh in $NIGHTLY." >&2; exit 1; }
  case "$NIGHTLY$HOME" in *[\<\>\&]*) echo "Refusing: the folder's name has < > or & in it." >&2; exit 1 ;; esac
  esc() { printf '%s' "$1" | sed -e 's/[|\\]/\\&/g'; }
  sed -e "s|__WORKDIR__|$(esc "$NIGHTLY")|g" -e "s|__HOME__|$(esc "$HOME")|g" "$NIGHTLY/deploy/mac/com.ezbiz.nightly.plist" > "$AGENTS/com.ezbiz.nightly.plist"
  plutil -lint "$AGENTS/com.ezbiz.nightly.plist" >/dev/null
  launchctl bootout "gui/$(id -u)/com.ezbiz.nightly" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/com.ezbiz.nightly.plist"
  echo "The nightly check runs at 19:15 from $NIGHTLY. Reports: ~/Downloads/ezbiz-nightly. Log: $LOGS/nightly.log"
fi
echo "Installed. Logs are in $LOGS"
