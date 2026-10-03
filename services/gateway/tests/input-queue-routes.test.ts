import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

describe("Space input queue public boundary", () => {
  it("forwards the verified actor and exact target, and rejects an injected author", async () => {
    const claims = {
      activeOrganizationId: "org-1",
      authenticated: true,
      authMethod: "session",
      callerPrincipalId: "owner-1",
      ownerIds: ["owner-1"],
      requestId: "queue-test",
    };
    const resolvedProfile = {
      ownerUserId: "owner-1",
      profileKind: "human",
      profileName: "Morgan",
      openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    };
    const spaceInputQueue = vi.fn(async () => ({ items: [] }));
    const env = {
      OPENMELD_AUTH_WORKER: {
        resolveRequestAuth: async () => ({ claims, ok: true }),
        resolveProfile: async () => ({ ok: true, resolvedProfile }),
        resolveRequestAuthWithProfile: async () => ({
          claims,
          ok: true,
          profile: { ok: true, resolvedProfile },
        }),
      },
      OPENMELD_CORE_WORKER: { spaceInputQueue },
    } as unknown as CloudflareBindings;
    const context = {
      exports: {},
      passThroughOnException: () => undefined,
      props: {},
      waitUntil: () => undefined,
    } as unknown as ExecutionContext;
    const mutation = {
      action: "steer",
      inputId: "pending-input",
      target: {
        dispatchId: "exact-dispatch",
        targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
      },
    };
    const send = (body: unknown) =>
      app.fetch(
        new Request("http://local/v1/spaces/space-1/input-queue", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
        context
      );
    expect((await send(mutation)).status).toBe(200);
    expect(spaceInputQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation,
        spaceId: "space-1",
        context: expect.objectContaining({
          actorContext: expect.objectContaining({
            openMeldProfileId: resolvedProfile.openMeldProfileId,
            ownerUserId: "owner-1",
          }),
        }),
      })
    );
    expect(
      (await send({ ...mutation, authorProfileId: "another-member" })).status
    ).toBe(400);
    expect(spaceInputQueue).toHaveBeenCalledOnce();
  });
});
