import { applyOpenMeldRequestContextHeaders } from "@openmeld/gateway-contract";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { createHttpApp } from "../src/app";
import type { CoreBindings } from "../src/lib/bindings";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";

type MembershipDbProbe = {
  bindings: unknown[];
  prepareCalls: string[];
};

function buildContext(
  input: { activeOrganizationId?: string; callerPrincipalId?: string } = {}
): OpenMeldRequestContext {
  return {
    actorContext: {
      requestId: "req-org-context-1",
      ...(input.callerPrincipalId
        ? { callerPrincipalId: input.callerPrincipalId }
        : {}),
      openMeldProfileId: HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Ada",
      ownerUserId: input.callerPrincipalId ?? "user-1",
    },
    ...(input.activeOrganizationId
      ? { activeOrganizationId: input.activeOrganizationId }
      : {}),
  };
}

function buildRequest(context: OpenMeldRequestContext): Request {
  const headers = applyOpenMeldRequestContextHeaders(new Headers(), {
    requestContext: context,
  });
  return new Request("https://core.local/v1/spaces/space-1/meta", {
    headers,
  });
}

function createMembershipDb(input: {
  member: boolean;
  throwOnLookup?: boolean;
}): { db: D1Database; probe: MembershipDbProbe } {
  const probe: MembershipDbProbe = {
    bindings: [],
    prepareCalls: [],
  };
  const db = {
    prepare(sql: string) {
      probe.prepareCalls.push(sql);
      return {
        bind(...values: unknown[]) {
          probe.bindings = values;
          return {
            first() {
              if (input.throwOnLookup) {
                throw new Error("raw d1 unavailable");
              }
              return input.member ? { id: "member-1", role: "member" } : null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, probe };
}

describe("Core active organization context", () => {
  it("rejects user-facing Core routes when active organization context is missing", async () => {
    const { db, probe } = createMembershipDb({ member: true });
    const response = await createHttpApp().fetch(
      buildRequest(buildContext({ callerPrincipalId: "user-1" })),
      { OPENMELD_DB: db } satisfies Partial<CoreBindings>
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "organization.context_required",
      message: "Active organization context is required.",
    });
    expect(probe.prepareCalls).toEqual([]);
  });

  it("rejects user-facing Core routes when the caller is not an organization member", async () => {
    const { db, probe } = createMembershipDb({ member: false });
    const response = await createHttpApp().fetch(
      buildRequest(
        buildContext({
          activeOrganizationId: "org-1",
          callerPrincipalId: "user-1",
        })
      ),
      { OPENMELD_DB: db } satisfies Partial<CoreBindings>
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "organization.membership_required",
      message: "You are not a member of the active organization.",
    });
    expect(probe.prepareCalls[0]).toContain("FROM members");
    expect(probe.bindings).toEqual(["org-1", "user-1"]);
  });

  it("fails closed with a classified error when membership lookup is unavailable", async () => {
    const { db } = createMembershipDb({
      member: false,
      throwOnLookup: true,
    });
    const response = await createHttpApp().fetch(
      buildRequest(
        buildContext({
          activeOrganizationId: "org-1",
          callerPrincipalId: "user-1",
        })
      ),
      { OPENMELD_DB: db } satisfies Partial<CoreBindings>
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "organization.context_unavailable",
      message: "Organization context could not be verified.",
    });
  });
});
