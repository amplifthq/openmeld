#!/usr/bin/env bash

set -euo pipefail

readonly destination="${1:-}"
: "${CANDIDATE_BRANCH:?Missing candidate branch.}"
: "${CANDIDATE_REPOSITORY:?Missing candidate repository.}"
: "${CANDIDATE_RUN_ID:?Missing current workflow run id.}"

if [ -z "$destination" ] ||
  [[ ! "$CANDIDATE_REPOSITORY" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]] ||
  [[ ! "$CANDIDATE_RUN_ID" =~ ^[1-9][0-9]*$ ]]; then
  echo "Prior Final Candidate evidence lookup received invalid identity." >&2
  exit 0
fi

mkdir -p "$destination"
run_ids="$(
  gh api -X GET \
    "repos/$CANDIDATE_REPOSITORY/actions/workflows/final-candidate.yml/runs" \
    -f branch="$CANDIDATE_BRANCH" \
    -f event=pull_request_target \
    -f status=completed \
    -f per_page=20 \
    --jq '.workflow_runs[] | select(.conclusion == "success") | .id' \
    2>/dev/null || true
)"

downloaded=0
while IFS= read -r run_id; do
  if [ -z "$run_id" ] || [ "$run_id" = "$CANDIDATE_RUN_ID" ]; then
    continue
  fi
  if [[ ! "$run_id" =~ ^[1-9][0-9]*$ ]]; then
    continue
  fi
  run_destination="$destination/$run_id"
  mkdir -p "$run_destination"
  if gh run download "$run_id" \
    --repo "$CANDIDATE_REPOSITORY" \
    --name final-candidate-evidence \
    --dir "$run_destination" >/dev/null 2>&1; then
    downloaded=$((downloaded + 1))
  else
    rmdir "$run_destination" 2>/dev/null || true
  fi
  if [ "$downloaded" -ge 5 ]; then
    break
  fi
done <<<"$run_ids"

chmod -R a-w "$destination" 2>/dev/null || true
echo "Prior Final Candidate evidence: $downloaded trusted workflow artifact(s) available for optional reuse."
