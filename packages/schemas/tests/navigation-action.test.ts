import { describe, expect, it } from "vitest";
import {
  buildOpenMeldNavigationAction,
  buildOpenMeldOrganizationWebUrl,
  buildOrganizationAppPath,
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
      buildOrganizationAppPath({ orgSlug: "amplift", service: "github" })
    ).toBe("/o/amplift/center-agent/apps/github");
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
      url: "https://openmeld.ai/o/amplift/center-agent/apps/github",
    });
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
      label: "Update OpenMeld Service",
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
        label: "Update OpenMeld Service",
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
