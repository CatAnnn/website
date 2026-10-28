#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
PACKAGE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$PACKAGE_DIR"
sha256sum -c SHA256SUMS
command -v python3 >/dev/null
command -v docker >/dev/null
exec python3 "$PACKAGE_DIR/recover.py" "$@"
