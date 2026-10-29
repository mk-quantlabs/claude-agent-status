#!/usr/bin/env bash
# Prints the Homebrew formula for a released version, with the checksum of its GitHub tarball.
#   packaging/homebrew/update-formula.sh 0.3.0 > ../homebrew-tap/Formula/agent-status.rb
set -euo pipefail
v="${1:?usage: update-formula.sh <version, e.g. 0.3.0>}"
v="${v#v}"
url="https://github.com/mk-quantlabs/claude-agent-status/archive/refs/tags/v$v.tar.gz"
sha="$(curl -fsSL "$url" | shasum -a 256 | cut -d' ' -f1)"
[ "${#sha}" = 64 ] || { echo "could not download $url" >&2; exit 1; }
sed -e "s|{{VERSION}}|$v|g" -e "s|{{SHA256}}|$sha|g" "$(dirname "$0")/agent-status.rb.in"
