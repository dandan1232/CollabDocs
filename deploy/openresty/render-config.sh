#!/usr/bin/env sh
set -eu

: "${COLLABDOCS_DOMAIN:?COLLABDOCS_DOMAIN is required}"
: "${TLS_CERTIFICATE:?TLS_CERTIFICATE is required}"
: "${TLS_CERTIFICATE_KEY:?TLS_CERTIFICATE_KEY is required}"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TEMPLATE_PATH=${1:-"$SCRIPT_DIR/collabdocs.conf.template"}
OUTPUT_PATH=${2:-"$SCRIPT_DIR/collabdocs.conf"}

command -v envsubst >/dev/null 2>&1 || {
  echo "envsubst is required to render the OpenResty configuration." >&2
  exit 1
}

envsubst '${COLLABDOCS_DOMAIN} ${TLS_CERTIFICATE} ${TLS_CERTIFICATE_KEY}' \
  < "$TEMPLATE_PATH" > "$OUTPUT_PATH"

echo "Rendered OpenResty configuration: $OUTPUT_PATH"
