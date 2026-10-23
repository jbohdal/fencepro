#!/bin/bash
# Set secrets in the live app's settings file (~/ezbiz/apps/portal/.env) without
# ever showing them, then restart the app so it reads them.
#
#   bash ~/ezbiz/deploy/mac/set-secret.sh esri      ESRI_API_KEY (asked, hidden)
#   bash ~/ezbiz/deploy/mac/set-secret.sh email     the Google Workspace email set:
#                                                   SMTP_HOST smtp.gmail.com, SMTP_PORT 465,
#                                                   SMTP_USER and SMTP_FROM_EMAIL sales@gdfencepro.com,
#                                                   SMTP_FROM "Getter Done Fence", SMTP_PASS (asked, hidden)
#   bash ~/ezbiz/deploy/mac/set-secret.sh NAME      any one setting by name (asked, hidden)
#
# A secret can also be piped in instead of typed (one line per asked value):
#   printf '%s\n' "$VALUE" | bash ~/ezbiz/deploy/mac/set-secret.sh esri
#
# What it does: copies .env to ~/ezbiz-backups/portal-env.<date-time> first;
# replaces a setting's line when it is there (every copy of it, so it is never
# duplicated) or adds it at the end; never prints a value (only "set (N
# characters)"); then `pm2 restart ezbiz --update-env`. Only the live file is
# ever written; the working folder's settings are not touched.
set -euo pipefail

ENV_FILE="${EZBIZ_ENV_FILE:-$HOME/ezbiz/apps/portal/.env}"
BACKUP_DIR="$HOME/ezbiz-backups"

if [ ! -f "$ENV_FILE" ]; then echo "No settings file at $ENV_FILE"; exit 1; fi

ask() { # ask NAME PROMPT -> the value on stdout, hidden while typed
  local v=""
  if [ -t 0 ]; then
    read -r -s -p "$2: " v; echo >&2
  else
    IFS= read -r v || true
  fi
  if [ -z "$v" ]; then echo "Nothing entered for $1; nothing changed." >&2; exit 1; fi
  printf '%s' "$v"
}

# The settings to write, as NAME and value pairs (values never echoed).
NAMES=(); VALUES=()
add() { NAMES+=("$1"); VALUES+=("$2"); }

case "${1:-}" in
  esri)
    add ESRI_API_KEY "$(ask ESRI_API_KEY 'Esri API key (typing is hidden)')"
    ;;
  email)
    add SMTP_HOST "smtp.gmail.com"
    add SMTP_PORT "465"
    add SMTP_USER "sales@gdfencepro.com"
    add SMTP_FROM_EMAIL "sales@gdfencepro.com"
    add SMTP_FROM "Getter Done Fence"
    add SMTP_PASS "$(ask SMTP_PASS 'Google App Password for sales@gdfencepro.com, 16 letters (typing is hidden)' | tr -d ' ')"
    ;;
  ""|-h|--help)
    sed -n '2,20p' "$0"; exit 0
    ;;
  *)
    if ! [[ "$1" =~ ^[A-Z][A-Z0-9_]*$ ]]; then echo "A setting name is capital letters, digits and _ (like ESRI_API_KEY)."; exit 1; fi
    add "$1" "$(ask "$1" "$1 (typing is hidden)")"
    ;;
esac

mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
backup="$BACKUP_DIR/portal-env.$(date +%Y-%m-%d_%H%M%S)"
cp -p "$ENV_FILE" "$backup"; chmod 600 "$backup"
echo "Backed up the settings file to $backup"

# Rewrite the file in one go: keep every other line; drop old lines of the names
# being set; add each name once at the end. Values go through the environment,
# never the command line, so they do not show up in a process list.
tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
chmod 600 "$tmp"
for i in "${!NAMES[@]}"; do export "EZ_SET_NAME_$i=${NAMES[$i]}" "EZ_SET_VALUE_$i=${VALUES[$i]}"; done
export EZ_SET_COUNT="${#NAMES[@]}"
python3 - "$ENV_FILE" "$tmp" <<'PY'
import os, re, sys
src, dst = sys.argv[1], sys.argv[2]
n = int(os.environ['EZ_SET_COUNT'])
pairs = [(os.environ[f'EZ_SET_NAME_{i}'], os.environ[f'EZ_SET_VALUE_{i}']) for i in range(n)]
names = {k for k, _ in pairs}
def quote(v):
    # dotenv: double quotes keep spaces; escape what would end or bend the quotes.
    if re.fullmatch(r'[A-Za-z0-9_./:@+=,-]*', v):
        return v
    return '"' + v.replace('\\', '\\\\').replace('"', '\\"') + '"'
out = []
with open(src) as f:
    for line in f:
        m = re.match(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=', line)
        if m and m.group(1) in names:
            continue
        out.append(line if line.endswith('\n') else line + '\n')
for k, v in pairs:
    out.append(f'{k}={quote(v)}\n')
with open(dst, 'w') as f:
    f.writelines(out)
PY
mv "$tmp" "$ENV_FILE"
for i in "${!NAMES[@]}"; do unset "EZ_SET_NAME_$i" "EZ_SET_VALUE_$i"; done

for i in "${!NAMES[@]}"; do echo "${NAMES[$i]}: set (${#VALUES[$i]} characters)"; done

if [ -n "${EZBIZ_ENV_FILE:-}" ]; then
  echo "(A test file was named, so EZ Biz was not restarted.)"
elif command -v pm2 >/dev/null 2>&1; then
  pm2 restart ezbiz --update-env >/dev/null && echo "EZ Biz restarted with the new settings."
else
  echo "pm2 not found: restart EZ Biz yourself (pm2 restart ezbiz --update-env)."
fi
