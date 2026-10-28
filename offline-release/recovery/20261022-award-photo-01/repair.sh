#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
PACKAGE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$PACKAGE_DIR"
sha256sum -c SHA256SUMS
exec python3 "$PACKAGE_DIR/repair.py" "$@" </dev/null
