import { describe, expect, it, vi } from "vitest";
import {
  createMemberAgentsApi,
  createOpenMeldApiClient,
  isMemberAgentsDisabledError,
  OpenMeldApiClientHttpError,
} from "../src";

const LISTING = {
  ok: true,
  organizationId: "org-1",
  memberAgents: [
    {
      id: "ma-1",
      organizationId: "org-1",
      ownerUserId: "user-1",
      harnessKind: "codex",
      defaultProfileId: "agt-1",
      source: "detected",
      archivedAt: null,
      profiles: [
        { openMeldProfileId: "agt-1", profileName: "Codex", isDefault: true },
      ],
    },
  ],
  unassignedProfiles: [
    { openMeldProfileId: "agt-9", profileName: "Custom reviewer" },
  ],
};

function createApi(response: Response) {
  const transport = vi.fn(() => Promise.resolve(response));
  const api = createMemberAgentsApi(
    createOpenMeldApiClient({
      baseUrl: "https://auth.openmeld.invalid",
      transport,
    })
  );
  return { api, transport };
}

describe("api-client member agents api", () => {
  it("does not treat other 404 responses as the disabled flag", () => {
    const error = new OpenMeldApiClientHttpError({
      code: "gateway.http_error",
      message: "Not found",
      rawBody: JSON.stringify({ ok: false, code: "profile.not_found" }),
      status: 404,
    });
    expect(isMemberAgentsDisabledError(error)).toBe(false);
  });

  it("reads the caller's MemberAgents from the Auth route", async () => {
    const { api, transport } = createApi(
      new Response(JSON.stringify(LISTING), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    );

    const result = await api.list();

    expect(result.memberAgents[0]?.harnessKind).toBe("codex");
    expect(result.unassignedProfiles).toHaveLength(1);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://auth.openmeld.invalid/v1/member-agents",
        operation: "member_agents.list",
        init: expect.objectContaining({ method: "GET" }),
      })
    );
  });

  it("keeps the disabled code from a flag-off route", async () => {
    const { api } = createApi(
      new Response(
        JSON.stringify({
          ok: false,
          code: "member_agents.disabled",
          message: "Agents grouped by harness are not available yet.",
        }),
        { headers: { "content-type": "application/json" }, status: 404 }
      )
    );

    const error = await api.list().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenMeldApiClientHttpError);
    expect((error as OpenMeldApiClientHttpError).status).toBe(404);
    expect(isMemberAgentsDisabledError(error)).toBe(true);
  });
});
