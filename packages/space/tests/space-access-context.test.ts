import { describe, expect, it } from "vitest";
import {
  createAnonymousViewerSpaceAccessContext,
  createAuthenticatedSpaceAccessContext,
  createDispatchContinuationSpaceAccessContext,
  getSpaceAccessPassword,
  getSpaceAccessRequestContext,
  getSpaceAccessRequestId,
  toSpaceAccessAuditFields,
} from "../src/access/space-access-context";

const requestContext = {
  actorContext: {
    openMeldProfileId: "usr_felix",
    ownerUserId: "owner-1",
    profileKind: "human" as const,
    profileName: "Felix Lu",
    requestId: "req-1",
  },
};

describe("SpaceAccessContext", () => {
  it("builds authenticated access with a space password proof", () => {
    const access = createAuthenticatedSpaceAccessContext({
      requestContext,
      spaceId: "space-1",
      password: "  secret-123  ",
    });

    expect(access).toEqual({
      spaceId: "space-1",
      actor: {
        kind: "authenticated",
        requestContext,
      },
      proof: {
        kind: "space_password",
        password: "secret-123",
      },
    });
    expect(getSpaceAccessRequestContext(access)).toBe(requestContext);
    expect(getSpaceAccessRequestId(access)).toBe("req-1");
    expect(getSpaceAccessPassword(access)).toBe("secret-123");
  });

  it("builds anonymous viewer access without granting authenticated identity", () => {
    const access = createAnonymousViewerSpaceAccessContext({
      requestId: "anon-req-1",
      spaceId: "space-1",
    });

    expect(access.actor).toEqual({
      kind: "anonymous_viewer",
      requestId: "anon-req-1",
    });
    expect(access.proof).toEqual({ kind: "none" });
    expect(getSpaceAccessRequestContext(access)).toBeNull();
    expect(getSpaceAccessRequestId(access)).toBe("anon-req-1");
  });

  it("builds dispatch continuation access with dispatch identity", () => {
    const access = createDispatchContinuationSpaceAccessContext({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      requestContext,
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agt-1",
    });

    expect(access.actor).toEqual({
      kind: "dispatch_continuation",
      requestContext,
      dispatchId: "dispatch-1",
      sourceSignalId: "signal-1",
      targetProfileId: "agt-1",
      attemptId: "attempt-1",
    });
    expect(access.proof).toEqual({ kind: "none" });
  });

  it("redacts password values from audit fields", () => {
    const access = createAuthenticatedSpaceAccessContext({
      requestContext,
      spaceId: "space-1",
      password: "secret-123",
    });

    expect(toSpaceAccessAuditFields(access)).toEqual({
      actorKind: "authenticated",
      hasSpacePasswordProof: true,
      proofKind: "space_password",
      spaceId: "space-1",
    });
    expect(JSON.stringify(toSpaceAccessAuditFields(access))).not.toContain(
      "secret-123"
    );
  });
});
