// Preserve the value written by supported installations. This is a disk-format
// contract, not the Runtime Transport epoch. A wire change cannot invalidate it.
// A future incompatible disk format needs versioned readers before new writers.
export const DAEMON_LOCAL_STATE_EPOCH =
  "runtime-transport-epoch-2026-07-default-project";
