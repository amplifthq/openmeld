import { describe, expect, it } from "vitest";
import { OpenMeldLockError } from "../src/config/lock";
import { buildDaemonServiceAlignmentFailureMessage } from "../src/local-service/lifecycle/daemon-service-alignment-executor";

describe("daemon service alignment failure presentation", () => {
  it("preserves repair guidance for an orphaned legacy lock", () => {
    const error = new OpenMeldLockError({
      path: "/tmp/daemon-service-reconcile.lock",
      key: "daemon-service-reconcile",
      metaRaw: '{"pid":22929}',
      contentionState: "orphaned",
    });

    const message = buildDaemonServiceAlignmentFailureMessage(error);

    expect(message).toBe(
      "OpenMeld found a local command lock left by an older version. Close any other OpenMeld commands, then run `openmeld repair local-state` and try again."
    );
    expect(message).not.toContain("already running in another local process");
    expect(message).not.toContain("/tmp/daemon-service-reconcile.lock");
  });

  it("keeps active alignment contention distinct from orphaned state", () => {
    const error = new OpenMeldLockError({
      path: "/tmp/daemon-service-reconcile.lock",
      key: "daemon-service-reconcile",
      metaRaw: '{"pid":22929}',
      contentionState: "active",
    });

    expect(buildDaemonServiceAlignmentFailureMessage(error)).toBe(
      "OpenMeld service alignment is already running in another local process."
    );
  });
});
