#!/usr/bin/env bash
#
# ioc-scan.sh — supply-chain / obfuscated-dropper guard.
#
# Greps a set of files for markers characteristic of the malware found in
# client/tailwind.config.js on 2026-09-08 (obfuscator.io identifier style,
# node:child_process use from config files, blockchain-C2 / dead-drop
# resolver strings, HTTP-header payload smuggling). Exits non-zero on the
# first hit so it can gate a commit or a CI build.
#
# Usage:
#   scripts/security/ioc-scan.sh <file> [<file> ...]     # scan specific files
#   scripts/security/ioc-scan.sh --staged               # scan git staged blobs
#   scripts/security/ioc-scan.sh --tree                 # scan whole working tree (tracked files)
#
# Exit codes: 0 = clean, 1 = marker(s) found, 2 = usage error.

set -euo pipefail

# One ERE, alternation of the agreed markers. Keep in sync with
# security/incident-2026-09/IOC-writeup.md §5.
PATTERN='_0x[0-9a-fA-F]{4,}\(0x[0-9a-fA-F]+\)|global\.i[[:space:]]*=[[:space:]]*["'"'"']A9-|x-payload-b64|eth_getBlockByNumber|eth_getTransactionCount|createRequire\(import\.meta\.url\)[^;]*;[^;]*\bspawn\b|blockscout\.com/api\?module=account|Sec-V'

# Broader, noisier markers — only applied to config/build files, where they
# have no legitimate reason to appear.
CONFIG_PATTERN='createRequire|child_process|[^a-zA-Z_.]eval\(|_0x[0-9a-fA-F]{4,}'
CONFIG_GLOB_RE='(^|/)(tailwind|postcss|vite|vitest|rollup|webpack|next|svelte|astro|eslint|prettier|babel)\.config\.[cm]?[jt]s$|(^|/)\.?(npmrc|babelrc)$|(^|/)package\.json$'

fail=0
scan_one() {
  # $1 = display path, $2 = actual file to read
  local disp="$1" file="$2"
  [ -f "$file" ] || return 0
  # skip the incident evidence copy and this repo's own security docs/scripts
  case "$disp" in
    security/incident-2026-09/*.malicious) return 0 ;;
    scripts/security/ioc-scan.sh)          return 0 ;;
    .github/workflows/ioc-scan.yml)        return 0 ;;
  esac

  if grep -nEI "$PATTERN" -- "$file" >/dev/null 2>&1; then
    echo "IOC MATCH (core) in: $disp"
    grep -nEI "$PATTERN" -- "$file" | sed 's/^/    /' | cut -c1-200
    fail=1
  fi

  if printf '%s' "$disp" | grep -qE "$CONFIG_GLOB_RE"; then
    if grep -nEI "$CONFIG_PATTERN" -- "$file" >/dev/null 2>&1; then
      echo "IOC MATCH (config-file rule) in: $disp"
      grep -nEI "$CONFIG_PATTERN" -- "$file" | sed 's/^/    /' | cut -c1-200
      fail=1
    fi
  fi
}

mode="${1:---tree}"
case "$mode" in
  --staged)
    # Scan the staged content (not the worktree) of added/copied/modified files.
    while IFS= read -r -d '' path; do
      tmp="$(mktemp)"
      if git show ":$path" > "$tmp" 2>/dev/null; then
        scan_one "$path" "$tmp"
      fi
      rm -f "$tmp"
    done < <(git diff --cached --name-only --diff-filter=ACM -z)
    ;;
  --tree)
    while IFS= read -r -d '' path; do
      scan_one "$path" "$path"
    done < <(git ls-files -z)
    ;;
  --help|-h)
    sed -n '2,20p' "$0"; exit 0
    ;;
  -*)
    echo "unknown option: $mode" >&2; exit 2
    ;;
  *)
    for path in "$@"; do scan_one "$path" "$path"; done
    ;;
esac

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "✗ ioc-scan: potential supply-chain marker(s) found (see above)."
  echo "  If this is a false positive, adjust scripts/security/ioc-scan.sh"
  echo "  in a dedicated, reviewed commit — do not bypass with --no-verify."
  exit 1
fi
echo "✓ ioc-scan: clean"
exit 0
