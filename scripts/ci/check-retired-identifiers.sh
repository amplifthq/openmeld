#!/usr/bin/env bash
# Retired-concept tripwire (docs/architecture/facts.md).
#
# These identifiers belong to machinery that has been physically deleted.
# If one reappears in live source, an agent or human is rebuilding a retired
# concept — stop and read docs/architecture/facts.md before proceeding.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Note: the legacy storage key "daemonhub.snapshot.v1" still has one allowed
# reference (the migration delete in runtime-transport-runtime-store.ts); add it here
# once that cleanup line is removed.
RETIRED_IDENTIFIERS=(
  "wakeRouteRegistrationSnapshot"
  "persistRuntimeTransportStateSnapshot"
  "restoreRuntimeTransportStateFromSnapshot"
  "restoreRuntimeTransportHibernatedSockets"
)

# Live source only: tombstone commits, docs, logs, and migration history are
# allowed to mention retired names.
SEARCH_PATHS=(services packages clients runtime scripts shared)

# OpenMeld is a greenfield product and must not silently depend on the retired
# WakeLoop brand, package scope, domains, environment keys, or local state.
# OpenMeld's greenfield database history uses OpenMeld physical identifiers, so
# the entire data layer stays in scope alongside product and deployment code.
RETIRED_BRAND_IDENTIFIERS=(
  "WakeLoop"
  "wakeLoop"
  "WAKELOOP_"
  "@wakeloop/"
  "wakeloop.ai"
  "sh.wakeloop"
  "wake_loop"
  "wakeloop"
)

BRAND_SEARCH_PATHS=(
  .
  ":(exclude)dev-tmp/**"
  ":(exclude).codegraph/**"
  ":(exclude)**/node_modules/**"
  ":(exclude)**/dist/**"
  ":(exclude)scripts/ci/check-retired-identifiers.sh"
)

failures=0
for identifier in "${RETIRED_IDENTIFIERS[@]}"; do
  if matches=$(grep -rn --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.turbo --exclude-dir=drizzle \
    -F "$identifier" "${SEARCH_PATHS[@]}" 2>/dev/null); then
    echo "RETIRED IDENTIFIER FOUND: '$identifier' (concept retired — see docs/architecture/facts.md)"
    echo "$matches" | head -5
    failures=1
  fi
done

for identifier in "${RETIRED_BRAND_IDENTIFIERS[@]}"; do
  if matches=$(git grep -n -F -- "$identifier" -- "${BRAND_SEARCH_PATHS[@]}"); then
    echo "RETIRED BRAND IDENTIFIER FOUND: '$identifier'"
    echo "$matches" | head -5
    failures=1
  else
    search_status=$?
    if [ "$search_status" -ne 1 ]; then
      echo "✗ Retired brand search failed for '$identifier' (git grep exit $search_status)."
      exit "$search_status"
    fi
  fi
done

if ! repository_paths=$(git ls-files -co --exclude-standard); then
  echo "✗ Could not enumerate repository paths for retired brand checking."
  exit 2
fi

if path_matches=$(printf '%s\n' "$repository_paths" | grep -i 'wakeloop'); then
  echo "RETIRED BRAND IDENTIFIER FOUND IN PATH"
  echo "$path_matches" | head -5
  failures=1
fi

if [ "$failures" -ne 0 ]; then
  echo ""
  echo "✗ Retired concepts resurfaced in live source. See docs/architecture/facts.md (禁用概念清单)."
  exit 1
fi
echo "✓ No retired identifiers in live source."
