#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE=/etc/reshis/duckdns.env
if [[ ! -r "$CONFIG_FILE" ]]; then
  echo "DuckDNS config is not readable: $CONFIG_FILE" >&2
  exit 1
fi

source "$CONFIG_FILE"
: "$DUCKDNS_DOMAIN"
: "$DUCKDNS_TOKEN"

response="$(curl --fail --silent --show-error --get \
  --data-urlencode "domains=$DUCKDNS_DOMAIN" \
  --data-urlencode "token=$DUCKDNS_TOKEN" \
  --data-urlencode "clear=true" \
  'https://www.duckdns.org/update')"

if [[ "$response" != "OK" ]]; then
  echo "DuckDNS TXT cleanup failed: $response" >&2
  exit 1
fi
