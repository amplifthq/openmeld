#!/usr/bin/env bash

set -euo pipefail

: "${OPENMELD_CANDIDATE_USER:?Missing isolated candidate user.}"
: "${OPENMELD_CANDIDATE_HOME:?Missing isolated candidate home.}"
: "${OPENMELD_CANDIDATE_ROOT:?Missing isolated candidate root.}"
: "${OPENMELD_TRUSTED_CONTROL_ROOT:?Missing trusted control root.}"
: "${OPENMELD_FINAL_CANDIDATE_EVIDENCE_ROOT:?Missing evidence root.}"

if id "$OPENMELD_CANDIDATE_USER" >/dev/null 2>&1; then
  echo "Isolated candidate user already exists: $OPENMELD_CANDIDATE_USER" >&2
  exit 65
fi

sudo useradd \
  --home-dir "$OPENMELD_CANDIDATE_HOME" \
  --no-create-home \
  --shell /usr/sbin/nologin \
  "$OPENMELD_CANDIDATE_USER"
sudo chgrp -R "$OPENMELD_CANDIDATE_USER" "$OPENMELD_CANDIDATE_ROOT"
sudo chmod -R g+rwX "$OPENMELD_CANDIDATE_ROOT"
chmod -R go-w "$OPENMELD_TRUSTED_CONTROL_ROOT"
install -d -m 0700 "$OPENMELD_FINAL_CANDIDATE_EVIDENCE_ROOT"
sudo install -d -m 0700 \
  -o "$OPENMELD_CANDIDATE_USER" \
  -g "$OPENMELD_CANDIDATE_USER" \
  "$OPENMELD_CANDIDATE_HOME"

printf '%s\n' \
  "Candidate isolation prepared" \
  "User: $OPENMELD_CANDIDATE_USER" \
  "Candidate root: $OPENMELD_CANDIDATE_ROOT" \
  "Candidate home: $OPENMELD_CANDIDATE_HOME" \
  "Trusted control: $OPENMELD_TRUSTED_CONTROL_ROOT" \
  "Evidence root: $OPENMELD_FINAL_CANDIDATE_EVIDENCE_ROOT"
