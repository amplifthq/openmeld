import { describe, expect, it, vi } from "vitest";
import { createOpenMeldApiClient, createOrganizationApi } from "../src";
import { capturedCompletedCreationRequest as request } from "./fixtures/agent-creation-request";

const command = {
  configuration: request.configuration,
  idempotencyKey: "one-creation-intent",
  organizationId: request.organizationId,
  profileName: request.profileName,
  requestedSpaceId: request.requestedSpaceId,
  sessionStrategy: request.sessionStrategy,
  source: request.source,
  targetOwnerUserId: request.targetOwnerUserId,
};

describe("Agent creation response recovery", () => {
  it("finds the exact accepted intent after a lost response without a second POST", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(
        Response.json({
          organizationId: command.organizationId,
          matchedIdempotencyKey: command.idempotencyKey,
          requests: [request],
        })
      );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.example.test",
        transport,
      })
    );
    expect(await api.createAgentProfileCreationRequest(command)).toMatchObject({
      replayed: true,
      request: { id: request.id, status: "completed" },
    });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.map(([call]) => call.init.method)).toEqual([
      "POST",
      "GET",
    ]);
    expect(transport.mock.calls[1]?.[0].url).toContain(
      "?idempotencyKey=one-creation-intent"
    );
  });

  it.each([
    undefined,
    "another-intent",
  ])("does not guess a match when the receiver has not confirmed the selector (%s)", async (matchedIdempotencyKey) => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(
        Response.json({
          organizationId: command.organizationId,
          matchedIdempotencyKey,
          requests: [request],
        })
      );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.example.test",
        transport,
      })
    );
    await expect(
      api.createAgentProfileCreationRequest(command)
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("does not treat a rejected command as an uncertain acceptance", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { ok: false, error: { code: "forbidden", message: "Forbidden" } },
          { status: 403 }
        )
      );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.example.test",
        transport,
      })
    );
    await expect(
      api.createAgentProfileCreationRequest(command)
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledOnce();
  });
});
