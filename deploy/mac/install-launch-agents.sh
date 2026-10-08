#!/bin/bash
# Install the two launch agents for the Mac install. Both start when you log
# in (FileVault keeps the disk locked until then). Safe to run again.
#
#   com.ezbiz.pm2      brings back the saved pm2 process list (the server)
#   com.ezbiz.backup   runs deploy/mac/backup.sh every night at 2:30
#
# Postgres has its own agent from: brew services start postgresql@16
set -euo pipefail

LIVE="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/ezbiz"
PM2_BIN="$(command -v pm2)"
mkdir -p "$AGENTS" "$LOGS"

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
echo "Installed. Logs are in $LOGS"
