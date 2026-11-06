#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE=/etc/reshis/duckdns.env
if [[ ! -r "$CONFIG_FILE" ]]; then
  echo "DuckDNS config is not readable: $CONFIG_FILE" >&2
  exit 1
fi

# This file is created on the server and must not be committed to the repository.
source "$CONFIG_FILE"
: "$DUCKDNS_DOMAIN"
: "$DUCKDNS_TOKEN"

response="$(curl --fail --silent --show-error --get \
  --data-urlencode "domains=$DUCKDNS_DOMAIN" \
  --data-urlencode "token=$DUCKDNS_TOKEN" \
  'https://www.duckdns.org/update')"

if [[ "$response" != "OK" ]]; then
  echo "DuckDNS update failed: $response" >&2
  exit 1
fi
echo "DuckDNS address updated."
