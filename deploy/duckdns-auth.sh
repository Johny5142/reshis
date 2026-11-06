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
: "$CERTBOT_DOMAIN"
: "$CERTBOT_VALIDATION"

if [[ "$CERTBOT_DOMAIN" != "$DUCKDNS_DOMAIN.duckdns.org" ]]; then
  echo "Certificate domain does not match configured DuckDNS hostname." >&2
  exit 1
fi

response="$(curl --fail --silent --show-error --get \
  --data-urlencode "domains=$DUCKDNS_DOMAIN" \
  --data-urlencode "token=$DUCKDNS_TOKEN" \
  --data-urlencode "txt=$CERTBOT_VALIDATION" \
  'https://www.duckdns.org/update')"

if [[ "$response" != "OK" ]]; then
  echo "DuckDNS TXT update failed: $response" >&2
  exit 1
fi

challenge="_acme-challenge.$CERTBOT_DOMAIN"
for attempt in $(seq 1 12); do
  if dig +short TXT "$challenge" | tr -d '"' | grep -Fxq "$CERTBOT_VALIDATION"; then
    exit 0
  fi
  sleep 5
done

echo "DuckDNS TXT record did not propagate for $challenge" >&2
exit 1
