#!/usr/bin/env bash

set -euo pipefail

: "${OPENMELD_CANDIDATE_USER:?Missing isolated candidate user.}"
: "${OPENMELD_CANDIDATE_HOME:?Missing isolated candidate home.}"
: "${OPENMELD_CANDIDATE_GIT_DIR:?Missing isolated candidate Git directory.}"
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
if [ ! -d "$OPENMELD_CANDIDATE_ROOT/.git" ]; then
  echo "Candidate checkout must contain a Git metadata directory before isolation." >&2
  exit 66
fi
if [ -e "$OPENMELD_CANDIDATE_GIT_DIR" ]; then
  echo "Candidate Git metadata destination already exists: $OPENMELD_CANDIDATE_GIT_DIR" >&2
  exit 67
fi

mv "$OPENMELD_CANDIDATE_ROOT/.git" "$OPENMELD_CANDIDATE_GIT_DIR"
sudo chgrp -R "$OPENMELD_CANDIDATE_USER" "$OPENMELD_CANDIDATE_GIT_DIR"
sudo chmod -R go-w,g+rX "$OPENMELD_CANDIDATE_GIT_DIR"
sudo chown -R "$OPENMELD_CANDIDATE_USER:$OPENMELD_CANDIDATE_USER" \
  "$OPENMELD_CANDIDATE_ROOT"
sudo chown "$(id -u):$(id -g)" "$OPENMELD_CANDIDATE_ROOT"
sudo chgrp "$OPENMELD_CANDIDATE_USER" "$OPENMELD_CANDIDATE_ROOT"
sudo chmod 1770 "$OPENMELD_CANDIDATE_ROOT"
printf 'gitdir: %s\n' "$OPENMELD_CANDIDATE_GIT_DIR" > "$OPENMELD_CANDIDATE_ROOT/.git"
sudo chgrp "$OPENMELD_CANDIDATE_USER" "$OPENMELD_CANDIDATE_ROOT/.git"
chmod 0440 "$OPENMELD_CANDIDATE_ROOT/.git"
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
  "Read-only candidate Git metadata: $OPENMELD_CANDIDATE_GIT_DIR" \
  "Candidate home: $OPENMELD_CANDIDATE_HOME" \
  "Trusted control: $OPENMELD_TRUSTED_CONTROL_ROOT" \
  "Evidence root: $OPENMELD_FINAL_CANDIDATE_EVIDENCE_ROOT"
