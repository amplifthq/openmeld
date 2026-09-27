import { describe, expect, it } from "vitest";
import {
  buildOpenMeldNavigationAction,
  buildOpenMeldOrganizationWebUrl,
  buildOrganizationPluginPath,
  buildOrganizationSpacePath,
  buildSlackIdentityLinkNavigationAction,
  navigationActionSchema,
  openMeldNavigationTargetSchema,
} from "../src/navigation-action";

describe("buildOpenMeldNavigationAction", () => {
  it("shares the canonical Organization routes with OpenMeld Web", () => {
    expect(
      buildOpenMeldOrganizationWebUrl({
        organizationSlug: "amplift",
        webAppUrl: "https://openmeld.ai/ignored?old=true#old",
      })
    ).toBe("https://openmeld.ai/o/amplift");
    expect(
      buildOrganizationPluginPath({ orgSlug: "amplift", service: "github" })
    ).toBe("/o/amplift/plugins/github");
    expect(
      buildOrganizationSpacePath({
        orgSlug: "amplift",
        search: { thread: "thread 1" },
        spaceId: "space/1",
      })
    ).toBe("/o/amplift/spaces/space%2F1?thread=thread+1");
  });

  it("builds the current Organization's GitHub access action", () => {
    expect(
      buildOpenMeldNavigationAction({
        organizationWebUrl: "https://openmeld.ai/o/amplift",
        target: {
          kind: "organization_app",
          service: "github",
        },
      })
    ).toEqual({
      label: "Open GitHub access",
      target: {
        kind: "organization_app",
        service: "github",
      },
      url: "https://openmeld.ai/o/amplift/center-agent/plugins/github",
    });
  });

  it.each([
    ["github", "shared", "organization"],
    ["notion", "member", "personal"],
    ["cloudflare_r2", "choose", null],
  ] as const)("keeps %s connection intent and its fallback route aligned", (service, scope, routeScope) => {
    const action = buildOpenMeldNavigationAction({
      organizationWebUrl: "https://openmeld.ai/o/amplift/?old=true#old",
      target: { kind: "plugin_connection", service, scope },
    });
    expect(action.target).toEqual({
      kind: "plugin_connection",
      service,
      scope,
    });
    expect(action.url).toBe(
      `https://openmeld.ai/o/amplift/plugins/${service}${routeScope ? `?scope=${routeScope}` : ""}`
    );
  });

  it("does not accept credentials, guessed providers, or ambiguous connection scope in a message action", () => {
    const target = {
      kind: "plugin_connection",
      service: "github",
      scope: "member",
    };
    expect(
      openMeldNavigationTargetSchema.safeParse({ ...target, token: "secret" })
        .success
    ).toBe(false);
    expect(
      openMeldNavigationTargetSchema.safeParse({
        ...target,
        service: "unshipped_plugin",
      }).success
    ).toBe(false);
    expect(
      openMeldNavigationTargetSchema.safeParse({ ...target, scope: undefined })
        .success
    ).toBe(false);
  });

  it("builds an absolute link for a Space returned by an OpenMeld tool", () => {
    const spaceId = "a".repeat(64);

    expect(
      buildOpenMeldNavigationAction({
        organizationWebUrl: "https://openmeld.ai/o/amplift/",
        target: {
          kind: "space",
          spaceId,
        },
      })
    ).toEqual({
      label: "Open this Space",
      target: {
        kind: "space",
        spaceId,
      },
      url: `https://openmeld.ai/o/amplift/spaces/${spaceId}`,
    });
  });

  it("builds trusted Projects home and Project detail actions", () => {
    expect(
      buildOpenMeldNavigationAction({
        organizationWebUrl: "https://openmeld.ai/o/amplift",
        target: { kind: "projects" },
      })
    ).toEqual({
      label: "Open Projects",
      target: { kind: "projects" },
      url: "https://openmeld.ai/o/amplift/projects",
    });

    expect(
      buildOpenMeldNavigationAction({
        organizationWebUrl: "https://openmeld.ai/o/amplift",
        target: { kind: "project", projectId: "project/1" },
      })
    ).toEqual({
      label: "Open this Project",
      target: { kind: "project", projectId: "project/1" },
      url: "https://openmeld.ai/o/amplift/projects/project%2F1",
    });
  });

  it("builds trusted computer setup actions for setup, reconnect, and update", () => {
    expect(
      buildOpenMeldNavigationAction({
        organizationWebUrl: "https://openmeld.ai/o/amplift",
        target: {
          kind: "computer_setup",
          mode: "setup",
        },
      })
    ).toEqual({
      label: "Connect this computer",
      target: {
        kind: "computer_setup",
        mode: "setup",
      },
      url: "https://openmeld.ai/o/amplift/connect",
    });

    expect(
      buildOpenMeldNavigationAction({
        organizationWebUrl: "https://openmeld.ai/o/amplift",
        target: {
          connectedComputerId: "computer/1",
          kind: "computer_setup",
          mode: "reconnect",
        },
      })
    ).toEqual({
      label: "Reconnect this computer",
      target: {
        connectedComputerId: "computer/1",
        kind: "computer_setup",
        mode: "reconnect",
      },
      url: "https://openmeld.ai/o/amplift/connect?connectedComputerId=computer%2F1&session=fresh",
    });

    expect(
      buildOpenMeldNavigationAction({
        organizationWebUrl: "https://openmeld.ai/o/amplift",
        target: {
          connectedComputerId: "computer/1",
          kind: "computer_setup",
          mode: "update_service",
        },
      })
    ).toEqual({
      label: "Update OpenMeld on Computer",
      target: {
        connectedComputerId: "computer/1",
        kind: "computer_setup",
        mode: "update_service",
      },
      url: "https://openmeld.ai/o/amplift/connect?connectedComputerId=computer%2F1&serviceAction=update_service&session=fresh",
    });
  });

  it("requires a known computer for reconnect and update actions", () => {
    expect(
      navigationActionSchema.safeParse({
        label: "Reconnect this computer",
        target: {
          kind: "computer_setup",
          mode: "reconnect",
        },
        url: "https://openmeld.ai/o/amplift/connect?session=fresh",
      }).success
    ).toBe(false);

    expect(
      navigationActionSchema.safeParse({
        label: "Update OpenMeld on Computer",
        target: {
          kind: "computer_setup",
          mode: "update_service",
        },
        url: "https://openmeld.ai/o/amplift/connect?serviceAction=update_service",
      }).success
    ).toBe(false);
  });

  it("builds a direct one-time Slack account action that continues", () => {
    expect(
      buildSlackIdentityLinkNavigationAction({
        organizationName: "Acme",
        token: "slacklink_test",
        webAppUrl: "https://openmeld.ai/ignored?old=true#old",
      })
    ).toEqual({
      label: "Connect my account and continue",
      target: {
        kind: "message_channel_identity_link",
        purpose: "continue_request",
      },
      url: "https://openmeld.ai/link-slack?token=slacklink_test",
    });
  });

  it("accepts one intended OpenMeld account on a Message Channel connection target", () => {
    expect(
      openMeldNavigationTargetSchema.parse({
        connectToUserId: "user_mina",
        kind: "message_channel_identity_link",
        purpose: "continue_request",
        requestedAction: "Use my personal Computer",
      })
    ).toEqual({
      connectToUserId: "user_mina",
      kind: "message_channel_identity_link",
      purpose: "continue_request",
      requestedAction: "Use my personal Computer",
    });
  });

  it("accepts a structured Slack identity-link target without carrying a token", () => {
    expect(
      navigationActionSchema.safeParse({
        label: "Join Acme and continue",
        target: { kind: "slack_identity_link" },
        url: "https://openmeld.ai/link-slack?token=slacklink_test",
      })
    ).toMatchObject({
      data: {
        target: { kind: "slack_identity_link" },
      },
      success: true,
    });
  });

  it("rejects non-Web navigation protocols at the shared contract boundary", () => {
    expect(
      navigationActionSchema.safeParse({
        label: "Open GitHub access",
        target: { kind: "organization_app", service: "github" },
        url: "javascript:alert(1)",
      }).success
    ).toBe(false);
  });
});
