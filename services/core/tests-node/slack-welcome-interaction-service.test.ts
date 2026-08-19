import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleSlackWelcomeInteraction,
  requireRemoteAgentSlackTeammateInvitationDeliveryEvidence,
} from "../src/remote-agent/application/slack-welcome-interaction-service";
import {
  createFaultInjectingD1Database,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Slack welcome teammate invitations", () => {
  let harness: ReturnType<typeof createSqliteD1Harness>;
  let slackFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    createTables(harness);
    seedVerifiedMember(harness);
    slackFetch = vi.fn((url: string, request?: RequestInit) => {
      if (url.startsWith("https://slack.com/api/users.list")) {
        return Response.json({
          members: [
            {
              id: "U_ACTOR",
              profile: { display_name: "Alex", email: "alex@example.com" },
            },
            {
              id: "U_TARGET",
              profile: { display_name: "Maya", email: "maya@example.com" },
            },
          ],
          ok: true,
          response_metadata: { next_cursor: "" },
        });
      }
      if (url === "https://slack.com/api/chat.postMessage") {
        const body = JSON.parse(String(request?.body)) as { channel: string };
        return Response.json({ channel: body.channel, ok: true, ts: "1723.1" });
      }
      throw new Error(`Unexpected Slack request: ${url}`);
    });
    vi.stubGlobal("fetch", slackFetch);
  });

  it("accepts teammate invitation authority only from the matching current Slack delivery", () => {
    const privateDelivery = {
      conversationKind: "slack",
      deliveryId: "delivery-1",
      slackChannelId: "D_ACTOR",
      slackTeamId: "T1",
      workerSubmitRequest: {
        turnEnvelope: {
          interactionEnvironment: "requester_private",
          sender: {
            kind: "member",
            messageChannelIdentity: {
              connectionId: "T1",
              provider: "slack",
              providerUserId: "U_ACTOR",
            },
            ownerUserId: "user-actor",
            profileId: "profile-actor",
            verified: true,
          },
          trigger: { source: "slack", teamId: "T1" },
        },
      },
    };

    expect(() =>
      requireRemoteAgentSlackTeammateInvitationDeliveryEvidence({
        delivery: privateDelivery,
        representedHuman: {
          profileId: "profile-actor",
          userId: "user-actor",
        },
        slackTeamId: "T1",
        slackUserId: "U_ACTOR",
        sourceNativeDeliveryId: "delivery-1",
      })
    ).not.toThrow();
    expect(() =>
      requireRemoteAgentSlackTeammateInvitationDeliveryEvidence({
        delivery: {
          ...privateDelivery,
          slackChannelId: "C_TEAM",
          workerSubmitRequest: {
            ...privateDelivery.workerSubmitRequest,
            turnEnvelope: {
              ...privateDelivery.workerSubmitRequest.turnEnvelope,
              interactionEnvironment: "organization_shared",
            },
          },
        },
        representedHuman: {
          profileId: "profile-actor",
          userId: "user-actor",
        },
        slackTeamId: "T1",
        slackUserId: "U_ACTOR",
        sourceNativeDeliveryId: "delivery-1",
      })
    ).not.toThrow();
    expect(() =>
      requireRemoteAgentSlackTeammateInvitationDeliveryEvidence({
        delivery: {
          ...privateDelivery,
          workerSubmitRequest: {
            ...privateDelivery.workerSubmitRequest,
            turnEnvelope: {
              ...privateDelivery.workerSubmitRequest.turnEnvelope,
              interactionEnvironment: "organization_shared",
            },
          },
        },
        representedHuman: {
          profileId: "profile-actor",
          userId: "user-actor",
        },
        slackTeamId: "T1",
        slackUserId: "U_ACTOR",
        sourceNativeDeliveryId: "delivery-1",
      })
    ).toThrow("active Slack delivery");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    harness.close();
  });

  it.each([
    {
      action: "open_teammate_invite_modal" as const,
      readyElementType: "multi_users_select",
    },
    {
      action: "open_channel_introduction_modal" as const,
      readyElementType: "multi_channels_select",
    },
  ])("opens a safe checking modal before membership verification for $action", async ({
    action,
    readyElementType,
  }) => {
    const activeMembership = {
      account: {
        defaultHumanProfile: null,
        displayName: "Alex",
        email: "alex@example.com",
        membership: { memberId: "member-actor", role: "member" as const },
        userId: "user-actor",
      },
      ok: true as const,
      organization: {
        id: "org-1",
        memberCount: 2,
        name: "Ampli Lift",
        personal: false,
        slug: "ampli-lift",
      },
    };
    let resolveMembership!: (value: typeof activeMembership) => void;
    const membership = new Promise<typeof activeMembership>((resolve) => {
      resolveMembership = resolve;
    });
    const resolveOrganizationAccountIdentity = vi.fn(() => membership);
    let markModalOpened!: () => void;
    const modalOpened = new Promise<void>((resolve) => {
      markModalOpened = resolve;
    });
    slackFetch.mockImplementation((url: string) => {
      if (url === "https://slack.com/api/views.open") {
        markModalOpened();
        return Response.json({
          ok: true,
          view: { hash: "view-hash-1", id: "V_LOADING" },
        });
      }
      if (url === "https://slack.com/api/views.update") {
        return Response.json({
          ok: true,
          view: { hash: "view-hash-2", id: "V_LOADING" },
        });
      }
      throw new Error(`Unexpected Slack request: ${url}`);
    });

    const handling = handleSlackWelcomeInteraction(
      buildEnv({
        db: harness.db,
        ensureOrganizationJoinLinkOnBehalfOf: vi.fn(),
        resolveOrganizationAccountIdentity,
      }),
      {
        action,
        gatewayRequestId: "dbf560cc-4d2c-4d8a-ae9a-27affd7e41e8",
        interactionReceivedAtMs: Date.now(),
        slackTeamId: "T1",
        slackUserId: "U_ACTOR",
        triggerId: "trigger-1",
      }
    );
    const openedBeforeMembership = await Promise.race([
      modalOpened.then(() => true),
      new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), 50);
      }),
    ]);
    resolveMembership(activeMembership);
    await expect(handling).resolves.toEqual({ handled: true });

    expect(openedBeforeMembership).toBe(true);
    const modalRequests = slackFetch.mock.calls.map(([, request]) =>
      JSON.parse(String(request?.body))
    );
    expect(modalRequests).toHaveLength(2);
    expect(modalRequests[0]).toEqual({
      trigger_id: "trigger-1",
      view: expect.objectContaining({
        blocks: [
          expect.objectContaining({
            text: expect.objectContaining({
              text: "Checking your OpenMeld access…",
            }),
          }),
        ],
        type: "modal",
      }),
    });
    expect(JSON.stringify(modalRequests[0])).not.toContain('"type":"input"');
    expect(modalRequests[1]).toEqual(
      expect.objectContaining({
        hash: "view-hash-1",
        view: expect.objectContaining({ type: "modal" }),
        view_id: "V_LOADING",
      })
    );
    expect(JSON.stringify(modalRequests[1])).toContain(
      `"type":"${readyElementType}"`
    );
  });

  it("replaces the checking modal with a private access failure", async () => {
    const resolveOrganizationAccountIdentity = vi.fn(async () => ({
      account: {
        defaultHumanProfile: null,
        displayName: "Alex",
        email: "alex@example.com",
        membership: null,
        userId: "user-actor",
      },
      ok: true as const,
      organization: {
        id: "org-1",
        memberCount: 1,
        name: "Ampli Lift",
        personal: false,
        slug: "ampli-lift",
      },
    }));
    slackFetch.mockImplementation((url: string) => {
      if (url === "https://slack.com/api/views.open") {
        return Response.json({
          ok: true,
          view: { hash: "view-hash-1", id: "V_LOADING" },
        });
      }
      if (url === "https://slack.com/api/views.update") {
        return Response.json({
          ok: true,
          view: { hash: "view-hash-2", id: "V_LOADING" },
        });
      }
      throw new Error(`Unexpected Slack request: ${url}`);
    });

    await expect(
      handleSlackWelcomeInteraction(
        buildEnv({
          db: harness.db,
          ensureOrganizationJoinLinkOnBehalfOf: vi.fn(),
          resolveOrganizationAccountIdentity,
        }),
        {
          action: "open_teammate_invite_modal",
          interactionReceivedAtMs: Date.now(),
          slackTeamId: "T1",
          slackUserId: "U_ACTOR",
          triggerId: "trigger-1",
        }
      )
    ).resolves.toEqual({ handled: true });

    const updateBody = JSON.parse(String(slackFetch.mock.calls[1]?.[1]?.body));
    expect(JSON.stringify(updateBody)).toContain(
      "you’re no longer a member of this OpenMeld Organization"
    );
    expect(JSON.stringify(updateBody)).not.toContain("multi_users_select");
  });

  it("does not leave the checking modal open when membership verification stalls", async () => {
    vi.useFakeTimers();
    const activeMembership = {
      account: {
        defaultHumanProfile: null,
        displayName: "Alex",
        email: "alex@example.com",
        membership: { memberId: "member-actor", role: "member" as const },
        userId: "user-actor",
      },
      ok: true as const,
      organization: {
        id: "org-1",
        memberCount: 2,
        name: "Ampli Lift",
        personal: false,
        slug: "ampli-lift",
      },
    };
    let resolveMembership!: (value: typeof activeMembership) => void;
    const membership = new Promise<typeof activeMembership>((resolve) => {
      resolveMembership = resolve;
    });
    let markModalOpened!: () => void;
    const modalOpened = new Promise<void>((resolve) => {
      markModalOpened = resolve;
    });
    slackFetch.mockImplementation((url: string) => {
      if (url === "https://slack.com/api/views.open") {
        markModalOpened();
        return Response.json({
          ok: true,
          view: { hash: "view-hash-1", id: "V_LOADING" },
        });
      }
      if (url === "https://slack.com/api/views.update") {
        return Response.json({
          ok: true,
          view: { hash: "view-hash-2", id: "V_LOADING" },
        });
      }
      throw new Error(`Unexpected Slack request: ${url}`);
    });

    const handling = handleSlackWelcomeInteraction(
      buildEnv({
        db: harness.db,
        ensureOrganizationJoinLinkOnBehalfOf: vi.fn(),
        resolveOrganizationAccountIdentity: vi.fn(() => membership),
      }),
      {
        action: "open_teammate_invite_modal",
        interactionReceivedAtMs: Date.now(),
        slackTeamId: "T1",
        slackUserId: "U_ACTOR",
        triggerId: "trigger-1",
      }
    );
    await modalOpened;
    await vi.advanceTimersByTimeAsync(8000);
    vi.useRealTimers();
    const settledAfterBudget = await Promise.race([
      handling.then(() => true),
      new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), 100);
      }),
    ]);
    resolveMembership(activeMembership);
    await handling;

    expect(settledAfterBudget).toBe(true);
    const updateBody = JSON.parse(String(slackFetch.mock.calls[1]?.[1]?.body));
    expect(JSON.stringify(updateBody)).toContain(
      "OpenMeld couldn’t verify your access"
    );
    expect(JSON.stringify(updateBody)).not.toContain("multi_users_select");
  });

  it("does not exchange a Slack trigger after its presentation budget", async () => {
    await expect(
      handleSlackWelcomeInteraction(
        buildEnv({
          db: harness.db,
          ensureOrganizationJoinLinkOnBehalfOf: vi.fn(),
        }),
        {
          action: "open_teammate_invite_modal",
          interactionReceivedAtMs: Date.now() - 3000,
          slackTeamId: "T1",
          slackUserId: "U_ACTOR",
          triggerId: "expired-trigger",
        }
      )
    ).resolves.toEqual({ handled: true });

    expect(
      slackFetch.mock.calls.filter(
        ([url]) => url === "https://slack.com/api/views.open"
      )
    ).toHaveLength(0);
    expect(
      slackFetch.mock.calls.filter(
        ([url]) => url === "https://slack.com/api/chat.postMessage"
      )
    ).toHaveLength(1);
  });

  it("lets a verified member share an existing Organization invite link", async () => {
    seedActiveJoinLink(harness);
    const ensureOrganizationJoinLinkOnBehalfOf = vi.fn();

    await expect(
      handleSlackWelcomeInteraction(
        buildEnv({ db: harness.db, ensureOrganizationJoinLinkOnBehalfOf }),
        teammateInviteInput()
      )
    ).resolves.toEqual({ handled: true });

    expect(ensureOrganizationJoinLinkOnBehalfOf).not.toHaveBeenCalled();
    const publications = slackFetch.mock.calls
      .filter(([url]) => url === "https://slack.com/api/chat.postMessage")
      .map(
        ([, request]) =>
          JSON.parse(String(request?.body)) as Record<string, unknown>
      );
    expect(publications).toHaveLength(2);
    expect(publications[0]).toMatchObject({
      channel: "U_TARGET",
      metadata: {
        event_payload: { delivery_id: "V1:U_TARGET" },
        event_type: "openmeld_teammate_invited",
      },
      text: expect.stringContaining("Center Agent for *Ampli Lift*"),
    });
    expect(publications[0]?.text).toEqual(
      expect.stringContaining(
        "open your Human Profile in People and connect this Slack account"
      )
    );
    expect(JSON.stringify(publications[0]?.blocks)).toContain(
      "https://openmeld.test/join-organization?token=join-token-1"
    );
    expect(publications[1]).toMatchObject({
      channel: "U_ACTOR",
      text: expect.stringContaining("Maya"),
    });
  });

  it("does not invite a teammate who is already in the OpenMeld Organization", async () => {
    seedActiveJoinLink(harness);
    const resolveOrganizationDirectoryMembers = vi.fn(async () => ({
      members: [
        buildDirectoryMember({
          email: "alex@example.com",
          memberId: "member-actor",
          name: "Alex",
          userId: "user-actor",
        }),
        buildDirectoryMember({
          email: "MAYA@EXAMPLE.COM",
          memberId: "member-maya",
          name: "Maya",
          userId: "user-maya",
        }),
      ],
      ok: true as const,
      organizationId: "org-1",
    }));

    await expect(
      handleSlackWelcomeInteraction(
        buildEnv({
          db: harness.db,
          ensureOrganizationJoinLinkOnBehalfOf: vi.fn(),
          resolveOrganizationDirectoryMembers,
        }),
        teammateInviteInput()
      )
    ).resolves.toEqual({ handled: true });

    expect(resolveOrganizationDirectoryMembers).toHaveBeenCalledWith({
      organizationId: "org-1",
    });
    const publications = slackFetch.mock.calls
      .filter(([url]) => url === "https://slack.com/api/chat.postMessage")
      .map(
        ([, request]) =>
          JSON.parse(String(request?.body)) as Record<string, unknown>
      );
    expect(publications).toEqual([
      expect.objectContaining({
        channel: "U_ACTOR",
        text: expect.stringContaining("Maya is already in Ampli Lift"),
      }),
    ]);
    expect(
      harness.queryFirst({
        sql: "SELECT status FROM slack_teammate_invitation_deliveries",
      })
    ).toBeNull();
  });

  it("sends no invitations and gives one retry when membership checking is unavailable", async () => {
    seedActiveJoinLink(harness);
    const resolveOrganizationDirectoryMembers = vi.fn(async () => ({
      code: "auth.organization_directory_unavailable",
      message: "Organization Directory members are temporarily unavailable.",
      ok: false as const,
    }));

    await expect(
      handleSlackWelcomeInteraction(
        buildEnv({
          db: harness.db,
          ensureOrganizationJoinLinkOnBehalfOf: vi.fn(),
          resolveOrganizationDirectoryMembers,
        }),
        teammateInviteInput()
      )
    ).resolves.toEqual({ handled: true });

    const publications = slackFetch.mock.calls
      .filter(([url]) => url === "https://slack.com/api/chat.postMessage")
      .map(
        ([, request]) =>
          JSON.parse(String(request?.body)) as Record<string, unknown>
      );
    expect(publications).toEqual([
      expect.objectContaining({
        channel: "U_ACTOR",
        text: expect.stringContaining("no invitations were sent"),
      }),
    ]);
    expect(String(publications[0]?.text)).toContain(
      "In a moment, open Invite teammates and choose them again."
    );
    expect(String(publications[0]?.text)).not.toContain("reconnect Slack");
  });

  it("keeps a confirmed teammate invitation delivered when its first checkpoint write fails", async () => {
    seedActiveJoinLink(harness);
    const db = createFaultInjectingD1Database({
      db: harness.db,
      matches: (sql, operation) =>
        operation === "run" &&
        sql.includes("UPDATE slack_teammate_invitation_deliveries") &&
        sql.includes("SET status = ?"),
    });

    await expect(
      handleSlackWelcomeInteraction(
        buildEnv({
          db,
          ensureOrganizationJoinLinkOnBehalfOf: vi.fn(),
        }),
        teammateInviteInput()
      )
    ).resolves.toEqual({ handled: true });

    expect(
      slackFetch.mock.calls.filter(
        ([url]) => url === "https://slack.com/api/chat.postMessage"
      )
    ).toHaveLength(2);
    expect(
      harness.queryFirst({
        sql: `SELECT status, message_ts, failure_code, onboarding_status
          FROM slack_teammate_invitation_deliveries`,
      })
    ).toEqual({
      failure_code: null,
      message_ts: "1723.1",
      onboarding_status: "waiting_for_join",
      status: "delivered",
    });
  });

  it("stops reading the Slack roster once every selected teammate is resolved", async () => {
    seedActiveJoinLink(harness);
    slackFetch.mockImplementation((url: string, request?: RequestInit) => {
      if (url.startsWith("https://slack.com/api/users.list")) {
        const cursor = new URL(url).searchParams.get("cursor");
        if (cursor === "page-2") {
          return Response.json({
            members: [
              {
                id: "U_UNRELATED",
                profile: { display_name: "Sam", email: "sam@example.com" },
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          });
        }
        return Response.json({
          members: [
            {
              id: "U_ACTOR",
              profile: { display_name: "Alex", email: "alex@example.com" },
            },
            {
              id: "U_TARGET",
              profile: { display_name: "Maya", email: "maya@example.com" },
            },
          ],
          ok: true,
          response_metadata: { next_cursor: "page-2" },
        });
      }
      if (url === "https://slack.com/api/chat.postMessage") {
        const body = JSON.parse(String(request?.body)) as { channel: string };
        return Response.json({ channel: body.channel, ok: true, ts: "1723.1" });
      }
      throw new Error(`Unexpected Slack request: ${url}`);
    });

    await expect(
      handleSlackWelcomeInteraction(
        buildEnv({
          db: harness.db,
          ensureOrganizationJoinLinkOnBehalfOf: vi.fn(),
        }),
        teammateInviteInput()
      )
    ).resolves.toEqual({ handled: true });

    expect(
      slackFetch.mock.calls.filter(([url]) =>
        url.startsWith("https://slack.com/api/users.list")
      )
    ).toHaveLength(1);
  });

  it("keeps reading until both the selected teammate and inviter are resolved", async () => {
    seedActiveJoinLink(harness);
    slackFetch.mockImplementation((url: string, request?: RequestInit) => {
      if (url.startsWith("https://slack.com/api/users.list")) {
        const cursor = new URL(url).searchParams.get("cursor");
        if (cursor === "page-2") {
          return Response.json({
            members: [
              {
                id: "U_ACTOR",
                profile: { display_name: "Alex", email: "alex@example.com" },
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          });
        }
        return Response.json({
          members: [
            {
              id: "U_TARGET",
              profile: { display_name: "Maya", email: "maya@example.com" },
            },
          ],
          ok: true,
          response_metadata: { next_cursor: "page-2" },
        });
      }
      if (url === "https://slack.com/api/chat.postMessage") {
        const body = JSON.parse(String(request?.body)) as { channel: string };
        return Response.json({ channel: body.channel, ok: true, ts: "1723.1" });
      }
      throw new Error(`Unexpected Slack request: ${url}`);
    });

    await expect(
      handleSlackWelcomeInteraction(
        buildEnv({
          db: harness.db,
          ensureOrganizationJoinLinkOnBehalfOf: vi.fn(),
        }),
        teammateInviteInput()
      )
    ).resolves.toEqual({ handled: true });

    expect(
      slackFetch.mock.calls.filter(([url]) =>
        url.startsWith("https://slack.com/api/users.list")
      )
    ).toHaveLength(2);
    const invitation = slackFetch.mock.calls
      .filter(([url]) => url === "https://slack.com/api/chat.postMessage")
      .map(
        ([, request]) =>
          JSON.parse(String(request?.body)) as Record<string, unknown>
      )[0];
    expect(invitation).toMatchObject({
      channel: "U_TARGET",
      text: expect.stringContaining("Alex asked me to invite you"),
    });
  });

  it("does not send a targeted invite when Slack cannot safely correlate the teammate", async () => {
    seedActiveJoinLink(harness);
    slackFetch.mockImplementation((url: string, request?: RequestInit) => {
      if (url.startsWith("https://slack.com/api/users.list")) {
        return Response.json({
          members: [
            {
              id: "U_ACTOR",
              profile: { display_name: "Alex", email: "alex@example.com" },
            },
            {
              id: "U_TARGET",
              profile: { display_name: "Maya" },
            },
          ],
          ok: true,
          response_metadata: { next_cursor: "" },
        });
      }
      if (url === "https://slack.com/api/chat.postMessage") {
        const body = JSON.parse(String(request?.body)) as { channel: string };
        return Response.json({ channel: body.channel, ok: true, ts: "1723.1" });
      }
      throw new Error(`Unexpected Slack request: ${url}`);
    });

    await expect(
      handleSlackWelcomeInteraction(
        buildEnv({
          db: harness.db,
          ensureOrganizationJoinLinkOnBehalfOf: vi.fn(),
        }),
        teammateInviteInput()
      )
    ).resolves.toEqual({ handled: true });

    const publications = slackFetch.mock.calls
      .filter(([url]) => url === "https://slack.com/api/chat.postMessage")
      .map(
        ([, request]) =>
          JSON.parse(String(request?.body)) as Record<string, unknown>
      );
    expect(publications).toEqual([
      expect.objectContaining({
        channel: "U_ACTOR",
        text: expect.stringContaining("Slack didn’t share an email for Maya"),
      }),
    ]);
    expect(String(publications[0]?.text)).toContain(
      "https://openmeld.test/join-organization?token=join-token-1"
    );
    expect(
      harness.queryFirst({
        sql: "SELECT status FROM slack_teammate_invitation_deliveries",
      })
    ).toBeNull();
  });

  it("gives a member one clear next step when no invite link exists", async () => {
    const ensureOrganizationJoinLinkOnBehalfOf = vi.fn(async () => ({
      code: "organization.join_link.forbidden" as const,
      message: "Only an Organization owner or admin can create an invite link.",
      ok: false as const,
    }));

    await expect(
      handleSlackWelcomeInteraction(
        buildEnv({ db: harness.db, ensureOrganizationJoinLinkOnBehalfOf }),
        teammateInviteInput()
      )
    ).resolves.toEqual({ handled: true });

    expect(ensureOrganizationJoinLinkOnBehalfOf).toHaveBeenCalledOnce();
    const publications = slackFetch.mock.calls
      .filter(([url]) => url === "https://slack.com/api/chat.postMessage")
      .map(
        ([, request]) =>
          JSON.parse(String(request?.body)) as Record<string, unknown>
      );
    expect(publications).toEqual([
      expect.objectContaining({
        channel: "U_ACTOR",
        text: expect.stringContaining(
          "Ask an owner or admin to create one in OpenMeld"
        ),
      }),
    ]);
  });

  it("gives a stale Slack identity one private next step after the user leaves the Organization", async () => {
    seedActiveJoinLink(harness);
    const resolveOrganizationAccountIdentity = vi.fn(async () => ({
      account: {
        defaultHumanProfile: null,
        displayName: "Alex",
        email: "alex@example.com",
        membership: null,
        userId: "user-actor",
      },
      ok: true as const,
      organization: {
        id: "org-1",
        memberCount: 1,
        name: "Ampli Lift",
        personal: false,
        slug: "ampli-lift",
      },
    }));

    await expect(
      handleSlackWelcomeInteraction(
        buildEnv({
          db: harness.db,
          ensureOrganizationJoinLinkOnBehalfOf: vi.fn(),
          resolveOrganizationAccountIdentity,
        }),
        teammateInviteInput()
      )
    ).resolves.toEqual({ handled: true });

    expect(resolveOrganizationAccountIdentity).toHaveBeenCalledWith({
      account: { kind: "user_id", userId: "user-actor" },
      organizationId: "org-1",
    });
    const publications = slackFetch.mock.calls
      .filter(([url]) => url === "https://slack.com/api/chat.postMessage")
      .map(
        ([, request]) =>
          JSON.parse(String(request?.body)) as Record<string, unknown>
      );
    expect(publications).toEqual([
      expect.objectContaining({
        channel: "U_ACTOR",
        text: expect.stringContaining(
          "Ask an Organization owner or admin to add you again"
        ),
      }),
    ]);
  });
});

function buildEnv(input: {
  db: D1Database;
  ensureOrganizationJoinLinkOnBehalfOf: ReturnType<typeof vi.fn>;
  resolveOrganizationAccountIdentity?: ReturnType<typeof vi.fn>;
  resolveOrganizationDirectoryMembers?: ReturnType<typeof vi.fn>;
}): never {
  return {
    OPENMELD_AUTH_WORKER: {
      ensureOrganizationJoinLinkOnBehalfOf:
        input.ensureOrganizationJoinLinkOnBehalfOf,
      resolveOrganizationAccountIdentity:
        input.resolveOrganizationAccountIdentity ??
        vi.fn(async () => ({
          account: {
            defaultHumanProfile: null,
            displayName: "Alex",
            email: "alex@example.com",
            membership: { memberId: "member-actor", role: "member" as const },
            userId: "user-actor",
          },
          ok: true as const,
          organization: {
            id: "org-1",
            memberCount: 2,
            name: "Ampli Lift",
            personal: false,
            slug: "ampli-lift",
          },
        })),
      resolveOrganizationDirectoryMembers:
        input.resolveOrganizationDirectoryMembers ??
        vi.fn(async () => ({
          members: [
            buildDirectoryMember({
              email: "alex@example.com",
              memberId: "member-actor",
              name: "Alex",
              userId: "user-actor",
            }),
          ],
          ok: true as const,
          organizationId: "org-1",
        })),
    },
    OPENMELD_DB: input.db,
    SLACK_OPENMELD_BOT_TOKEN: "xoxb-test",
    WEB_APP_URL: "https://openmeld.test",
  } as never;
}

function buildDirectoryMember(input: {
  email: string;
  memberId: string;
  name: string;
  userId: string;
}) {
  return {
    humanProfile: null,
    joinedAt: "2026-08-15T00:00:00.000Z",
    memberId: input.memberId,
    organizationId: "org-1",
    role: "member" as const,
    user: {
      email: input.email,
      id: input.userId,
      image: null,
      name: input.name,
    },
    userId: input.userId,
  };
}

function teammateInviteInput() {
  return {
    action: "submit_teammate_invites" as const,
    interactionId: "V1",
    slackTeamId: "T1",
    slackUserId: "U_ACTOR",
    targetSlackUserIds: ["U_TARGET"],
  };
}

function createTables(harness: ReturnType<typeof createSqliteD1Harness>): void {
  for (const sql of [
    `CREATE TABLE openMeldRemoteAgent_slack_workspace_bindings (
      slack_team_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
    )`,
    `CREATE TABLE slack_user_identity_links (
      organization_id TEXT NOT NULL, slack_team_id TEXT NOT NULL,
      slack_user_id TEXT NOT NULL, openmeld_user_id TEXT NOT NULL,
      source TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (slack_team_id, slack_user_id)
    )`,
    `CREATE TABLE organizations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL
    )`,
    `CREATE TABLE slack_workspace_tokens (
      slack_team_id TEXT PRIMARY KEY, encrypted_bot_token TEXT NOT NULL,
      bot_user_id TEXT NOT NULL, granted_bot_scopes TEXT,
      installed_by_user_id TEXT NOT NULL,
      organization_id TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )`,
    `CREATE TABLE organization_join_links (
      organization_id TEXT PRIMARY KEY, token TEXT NOT NULL, revoked_at INTEGER
    )`,
    `CREATE TABLE slack_teammate_invitation_deliveries (
      interaction_id TEXT NOT NULL, slack_team_id TEXT NOT NULL,
      organization_id TEXT NOT NULL, actor_slack_user_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL, target_slack_user_id TEXT NOT NULL,
      target_email TEXT, target_display_name TEXT NOT NULL, status TEXT NOT NULL,
      message_ts TEXT, failure_code TEXT, onboarding_status TEXT,
      joined_user_id TEXT, joined_profile_id TEXT, research_task_id TEXT,
      welcome_message_ts TEXT, onboarding_failure_code TEXT,
      created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (interaction_id, target_slack_user_id)
    )`,
  ]) {
    harness.run({ sql });
  }
}

function seedVerifiedMember(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({
    sql: `INSERT INTO openMeldRemoteAgent_slack_workspace_bindings
      VALUES ('T1', 'org-1', 1, 1)`,
  });
  harness.run({
    sql: `INSERT INTO slack_user_identity_links
      VALUES ('org-1', 'T1', 'U_ACTOR', 'user-actor', 'explicit', 1)`,
  });
  harness.run({
    sql: `INSERT INTO organizations VALUES ('org-1', 'Ampli Lift')`,
  });
}

function seedActiveJoinLink(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({
    sql: `INSERT INTO organization_join_links
      VALUES ('org-1', 'join-token-1', NULL)`,
  });
}
