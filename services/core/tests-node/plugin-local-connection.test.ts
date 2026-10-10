import { readPluginConnectionReplyLink } from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localPluginConnectionGuidance } from "../src/connectors/plugin-connection-guidance";
import type { requireLocalPluginCaller } from "../src/connectors/plugin-local-caller";
import type { CoreBindings } from "../src/lib/bindings";

const owners = vi.hoisted(() => ({ slug: vi.fn() }));
vi.mock("../src/organizations/organization-context", () => ({
  readOrganizationRouteSlug: owners.slug,
}));
const env = { WEB_APP_URL: "https://openmeld.ai" } as CoreBindings;
const caller = {
  organizationId: "org",
  personalAllowed: true,
  sourceSpaceId: "space",
} as Awaited<ReturnType<typeof requireLocalPluginCaller>>;
describe("Local Plugin setup uses the same compatible connection card", () => {
  beforeEach(() => owners.slug.mockResolvedValue("acme"));
  it.each([
    "personal",
    "shared",
    "choose",
  ] as const)("preserves %s without starting authorization", async (account) => {
    const result = await localPluginConnectionGuidance(env, caller, {
      operation: "connect",
      service: "github",
      account,
    });
    expect(result.kind).toBe("connection_guidance");
    if (result.kind !== "connection_guidance") {
      throw new Error("Expected setup guidance");
    }
    expect(
      readPluginConnectionReplyLink({
        text: result.replyText,
        organizationSlug: "acme",
        webOrigin: "https://openmeld.ai",
      })?.action.target
    ).toEqual({
      kind: "plugin_connection",
      service: "github",
      scope: account === "personal" ? "member" : account,
    });
    expect(result.canContinueInConversation).toBe(true);
    expect(result.url).not.toContain("token");
  });
  it("never offers another user's personal account and does not pretend standalone CLI work has a Wake to resume", async () => {
    await expect(
      localPluginConnectionGuidance(
        env,
        { ...caller, personalAllowed: false },
        { operation: "connect", service: "linear", account: "personal" }
      )
    ).rejects.toThrow("plugin.personal_request_required");
    expect(
      await localPluginConnectionGuidance(
        env,
        { ...caller, personalAllowed: false, sourceSpaceId: null },
        { operation: "connect", service: "linear", account: "choose" }
      )
    ).toMatchObject({ scope: "shared", canContinueInConversation: false });
  });
  it("does not manufacture an authorization URL when the trusted origin is unavailable", async () => {
    await expect(
      localPluginConnectionGuidance({} as CoreBindings, caller, {
        operation: "connect",
        service: "github",
        account: "choose",
      })
    ).rejects.toThrow("plugin.connection_url_unavailable");
  });
  it("directs mailbox setup to the requester and never substitutes a personal account for an explicit shared request", async () => {
    expect(
      await localPluginConnectionGuidance(env, caller, {
        operation: "connect",
        service: "gmail",
        account: "choose",
      })
    ).toMatchObject({ scope: "member" });
    await expect(
      localPluginConnectionGuidance(env, caller, {
        operation: "connect",
        service: "gmail",
        account: "shared",
      })
    ).rejects.toThrow("plugin.personal_request_required");
    await expect(
      localPluginConnectionGuidance(
        env,
        { ...caller, personalAllowed: false },
        {
          operation: "connect",
          service: "gmail",
          account: "choose",
        }
      )
    ).rejects.toThrow("plugin.personal_request_required");
  });
});
