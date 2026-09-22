#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 2 ]; then
  echo "Usage: ./deploy/prepare-staging.sh SERVER_IPV4 ADMIN_EMAIL" >&2
  exit 2
fi
python3 - "$1" "$2" <<'PY'
import ipaddress
import os
import pathlib
import secrets
import sys

ip = str(ipaddress.IPv4Address(sys.argv[1]))
email = sys.argv[2].strip()
if not email or '@' not in email or any(char.isspace() for char in email):
    raise SystemExit('Enter the verified email for the permanent Clerk administrator.')
output = pathlib.Path('.env')
if output.exists():
    raise SystemExit('.env already exists; edit it instead of overwriting secrets.')

def local_values(path):
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('"\'')
    return values

local = local_values(pathlib.Path('.env.local'))
client = local_values(pathlib.Path('client/.env.local'))
publishable = local.get('CLERK_PUBLISHABLE_KEY') or client.get('VITE_CLERK_PUBLISHABLE_KEY', '')
secret = local.get('CLERK_SECRET_KEY', '')
domain = f'{ip.replace(".", "-")}.sslip.io'
values = {
    'DOMAIN': domain,
    'DEFAULT_ADMIN': email,
    'ADMIN_TOKEN': secrets.token_hex(32),
    'GRAFANA_ADMIN_PASSWORD': secrets.token_urlsafe(24),
    'API_WORKERS': '2',
    'CLERK_PUBLISHABLE_KEY': publishable,
    'CLERK_SECRET_KEY': secret,
}
old_mask = os.umask(0o077)
try:
    with output.open('x') as handle:
        for key, value in values.items():
            handle.write(f'{key}={value}\n')
finally:
    os.umask(old_mask)
print(f'Created private .env for https://{domain}')
print('Clerk staging keys:', 'present' if publishable and secret else 'missing; public browsing will still work')
print('Temporary staging is limited to Clerk development-instance capacity; buy a domain before public launch.')
PY
