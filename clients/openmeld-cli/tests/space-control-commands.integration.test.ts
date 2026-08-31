import { afterEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import { runSpaceContractSet } from "../src/space/contract-set-command";
import { runSpaceStatus } from "../src/space/status-command";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const passwordPromptMock = vi.hoisted(() => vi.fn());
const selectPromptMock = vi.hoisted(() => vi.fn());
const multiselectPromptMock = vi.hoisted(() => vi.fn());
const confirmPromptMock = vi.hoisted(() => vi.fn());

const PROFILE = {
  openMeldProfileId: "mira--phase5b-control",
  profileName: "Mira",
  profileHandle: "mira",
  profileKind: "human",
  status: "active",
  ownerUserId: "user-1",
  source: "cli_create",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-03-21T00:00:00.000Z",
  updatedAt: "2026-03-21T00:00:00.000Z",
} as const;

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const VALID_SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "http://localhost",
    clientId: "openmeld-cli",
    createdAt: "2026-03-21T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveFetchResponse(response: Response): Promise<Response> {
  return Promise.resolve(response);
}

function createProfilePayload(
  openMeldProfileId: string = PROFILE.openMeldProfileId
) {
  const isAgent = openMeldProfileId === "ops-bot--phase5b-control";
  return {
    ...PROFILE,
    openMeldProfileId,
    profileName: isAgent ? "Ops Bot" : PROFILE.profileName,
    profileHandle: isAgent ? "ops-bot" : PROFILE.profileHandle,
    profileKind: isAgent ? "agent" : PROFILE.profileKind,
  };
}

function readRequestJsonBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(init.body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function createProfileResponseForRequest(init?: RequestInit): Response {
  const body = readRequestJsonBody(init);
  const openMeldProfileId =
    typeof body.openMeldProfileId === "string"
      ? body.openMeldProfileId
      : PROFILE.openMeldProfileId;
  return createJsonResponse({
    profile: createProfilePayload(openMeldProfileId),
  });
}

function createProfilesListResponse(): Response {
  return createJsonResponse({
    profiles: [
      createProfilePayload(),
      createProfilePayload("ops-bot--phase5b-control"),
    ],
  });
}

function createControlProfileApiResponse(
  input: unknown,
  init?: RequestInit
): Response | null {
  const url = new URL(String(input));
  const method = String(init?.method ?? "GET").toUpperCase();
  if (url.pathname === "/v1/profiles/resolve" && method === "POST") {
    return createProfileResponseForRequest(init);
  }
  if (url.pathname === "/v1/profiles" && method === "GET") {
    return createProfilesListResponse();
  }
  return null;
}

function findSpaceFetchCall(
  calls: Parameters<typeof fetch>[],
  input: {
    pathSuffix: string;
    method?: string;
  }
) {
  const expectedMethod = input.method?.toUpperCase();
  return calls.find(([url, init]) => {
    if (!String(url).endsWith(input.pathSuffix)) {
      return false;
    }
    if (!expectedMethod) {
      return true;
    }
    return String(init?.method ?? "GET").toUpperCase() === expectedMethod;
  });
}

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: (input: unknown) => confirmPromptMock(input),
  isCancel: vi.fn(() => false),
  multiselect: (input: unknown) => multiselectPromptMock(input),
  note: vi.fn(),
  outro: vi.fn(),
  password: (input: unknown) => passwordPromptMock(input),
  select: (input: unknown) => selectPromptMock(input),
  spinner: vi.fn(),
  text: vi.fn(),
}));

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: vi.fn(
    async ({ openMeldProfileId }: { openMeldProfileId?: string }) => ({
      ...PROFILE,
      openMeldProfileId: String(openMeldProfileId ?? PROFILE.openMeldProfileId),
      profileKind:
        openMeldProfileId === "ops-bot--phase5b-control" ? "agent" : "human",
      profileName:
        openMeldProfileId === "ops-bot--phase5b-control" ? "Ops Bot" : "Mira",
      profileHandle:
        openMeldProfileId === "ops-bot--phase5b-control" ? "ops-bot" : "mira",
    })
  ),
}));

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (
      ...args: Parameters<typeof getAuthSessionStateMock>
    ) => getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => true),
}));

describe("space control commands", () => {
  afterEach(() => {
    getAuthSessionStateMock.mockReset();
    passwordPromptMock.mockReset();
    selectPromptMock.mockReset();
    multiselectPromptMock.mockReset();
    confirmPromptMock.mockReset();
    vi.restoreAllMocks();
  });

  it("renders human-readable contract set output for explicit flags", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input, init) => {
          const profileResponse = createControlProfileApiResponse(input, init);
          if (profileResponse) {
            return resolveFetchResponse(profileResponse);
          }
          return resolveFetchResponse(
            createJsonResponse({
              version: 2,
              updatedAt: "2026-03-21T00:01:00.000Z",
              updatedBy: PROFILE.openMeldProfileId,
              dispatchPolicy: { mode: "mention_only" },
              publicationMode: "raw_context_sharing",
              allowedActions: ["post_status", "stay_silent"],
              resultArchivePolicy: { mode: "space_reply_only" },
              authorityOrder: "default",
              entryBrief: "none",
              dispatchBrief: "default",
            })
          );
        });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceContractSet({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          dispatchPolicy: "mention_only",
          publicationMode: "transparent",
          allowedActions: "post_status,stay_silent",
          resultArchiveMode: "space_reply_only",
          entryBrief: "none",
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Space contract updated:");
      expect(plainStdout).toContain("transparent");
      expect(plainStdout).toContain("post_status | stay_silent");
      const requestInit = findSpaceFetchCall(fetchMock.mock.calls, {
        pathSuffix: `/v1/spaces/${VALID_SPACE_ID}/contract`,
        method: "PATCH",
      })?.[1];
      expect(JSON.parse(String(requestInit?.body))).toMatchObject({
        publicationMode: "raw_context_sharing",
      });
    });
  });

  it("preserves gateway code and requestId on space status failures across views", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
        await runInit({
          profile: "ops-bot--phase5b-control",
          profileId: "agt_11111111-1111-4111-8111-111111111111",
          profileName: "Ops Bot",
          kind: "agent",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "space.not_found",
                message: "Space not found.",
                requestId: "req-space-status-404",
              },
            }),
            {
              status: 404,
              headers: {
                "content-type": "application/json",
                "x-openmeld-request-id": "req-space-status-404",
              },
            }
          )
        )
      );

      const cases = [
        {
          view: "human" as const,
          profile: PROFILE.openMeldProfileId,
          json: false,
        },
        {
          view: "agent" as const,
          profile: "ops-bot--phase5b-control",
          json: true,
        },
      ];

      for (const testCase of cases) {
        await expect(
          runSpaceStatus({
            profile: testCase.profile,
            baseUrl: "http://localhost",
            space: VALID_SPACE_ID,
            json: testCase.json,
            view: testCase.view,
          })
        ).rejects.toMatchObject({
          code: "space.not_found",
          requestId: "req-space-status-404",
          message: "Space not found.",
        });
      }
    });
  });

  it("surfaces gateway listener failures with target context on space status", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("fetch failed")
      );

      await expect(
        runSpaceStatus({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost:8080",
          space: VALID_SPACE_ID,
          json: false,
          view: "human",
        })
      ).rejects.toMatchObject({
        code: "network.request_failed",
        message:
          "space.status.read request could not reach http://localhost:8080 (fetch failed)",
      });
    });
  });

  it("emits canonical json for contract set", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const profileResponse = createControlProfileApiResponse(input, init);
        if (profileResponse) {
          return resolveFetchResponse(profileResponse);
        }
        return resolveFetchResponse(
          createJsonResponse({
            version: 3,
            updatedAt: "2026-03-21T00:02:00.000Z",
            updatedBy: PROFILE.openMeldProfileId,
            dispatchPolicy: { mode: "listen_all" },
            publicationMode: "collaboration",
            allowedActions: ["post_message", "post_status", "stay_silent"],
            resultArchivePolicy: { mode: "all_final_results" },
            authorityOrder: "default",
            entryBrief: "default",
            dispatchBrief: "none",
          })
        );
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceContractSet({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          dispatchPolicy: "listen_all",
          dispatchBrief: "none",
          json: true,
          view: "human",
        });
      });

      expect(JSON.parse(stdout.trim())).toMatchObject({
        dispatchPolicy: { mode: "listen_all" },
        dispatchBrief: "none",
      });
    });
  });

  it("canonicalizes explicit allowedActions before sending a patch", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input, init) => {
          const profileResponse = createControlProfileApiResponse(input, init);
          if (profileResponse) {
            return resolveFetchResponse(profileResponse);
          }
          return resolveFetchResponse(
            createJsonResponse({
              version: 2,
              updatedAt: "2026-03-21T00:02:00.000Z",
              updatedBy: PROFILE.openMeldProfileId,
              dispatchPolicy: { mode: "mention_only" },
              publicationMode: "collaboration",
              allowedActions: ["post_status", "stay_silent"],
              resultArchivePolicy: { mode: "all_final_results" },
              authorityOrder: "default",
              entryBrief: "default",
              dispatchBrief: "default",
            })
          );
        });

      await withCapturedStdio(async () => {
        await runSpaceContractSet({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          allowedActions: "stay_silent,post_status",
          json: true,
          view: "human",
        });
      });

      const requestInit = findSpaceFetchCall(fetchMock.mock.calls, {
        pathSuffix: `/v1/spaces/${VALID_SPACE_ID}/contract`,
        method: "PATCH",
      })?.[1];
      expect(requestInit).toBeDefined();
      expect(JSON.parse(String(requestInit?.body))).toMatchObject({
        allowedActions: ["post_status", "stay_silent"],
      });
    });
  });

  it("runs the interactive contract set flow when no flags are provided", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });
      selectPromptMock
        .mockResolvedValueOnce("mention_only")
        .mockResolvedValueOnce("raw_context_sharing")
        .mockResolvedValueOnce("space_reply_only")
        .mockResolvedValueOnce("none")
        .mockResolvedValueOnce("default");
      multiselectPromptMock.mockResolvedValue(["post_status", "stay_silent"]);
      confirmPromptMock.mockResolvedValue(true);

      let contractRequestIndex = 0;
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input, init) => {
          const profileResponse = createControlProfileApiResponse(input, init);
          if (profileResponse) {
            return resolveFetchResponse(profileResponse);
          }
          contractRequestIndex += 1;
          if (contractRequestIndex === 1) {
            return resolveFetchResponse(
              createJsonResponse({
                version: 1,
                updatedAt: "2026-03-21T00:00:00.000Z",
                updatedBy: "system",
                dispatchPolicy: { mode: "mention_only" },
                publicationMode: "collaboration",
                allowedActions: ["post_message", "post_status", "stay_silent"],
                resultArchivePolicy: { mode: "all_final_results" },
                authorityOrder: "default",
                entryBrief: "default",
                dispatchBrief: "default",
              })
            );
          }
          return resolveFetchResponse(
            createJsonResponse({
              version: 2,
              updatedAt: "2026-03-21T00:01:00.000Z",
              updatedBy: PROFILE.openMeldProfileId,
              dispatchPolicy: { mode: "mention_only" },
              publicationMode: "raw_context_sharing",
              allowedActions: ["post_status", "stay_silent"],
              resultArchivePolicy: { mode: "space_reply_only" },
              authorityOrder: "default",
              entryBrief: "none",
              dispatchBrief: "default",
            })
          );
        });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceContractSet({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Space contract updated:");
      const spaceFetchCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes(`/spaces/${VALID_SPACE_ID}/contract`)
      );
      expect(spaceFetchCalls).toHaveLength(2);
      expect(spaceFetchCalls[0]?.[0]).toContain(
        `/spaces/${VALID_SPACE_ID}/contract`
      );
      expect(spaceFetchCalls[1]?.[0]).toContain(
        `/spaces/${VALID_SPACE_ID}/contract`
      );
    });
  });

  it("skips the write when interactive allowedActions only differ by order", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });
      selectPromptMock
        .mockResolvedValueOnce("mention_only")
        .mockResolvedValueOnce("collaboration")
        .mockResolvedValueOnce("all_final_results")
        .mockResolvedValueOnce("default")
        .mockResolvedValueOnce("default");
      multiselectPromptMock.mockResolvedValue(["stay_silent", "post_status"]);
      confirmPromptMock.mockResolvedValue(true);

      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input, init) => {
          const profileResponse = createControlProfileApiResponse(input, init);
          if (profileResponse) {
            return resolveFetchResponse(profileResponse);
          }
          return resolveFetchResponse(
            createJsonResponse({
              version: 3,
              updatedAt: "2026-03-21T00:00:00.000Z",
              updatedBy: PROFILE.openMeldProfileId,
              dispatchPolicy: { mode: "mention_only" },
              publicationMode: "collaboration",
              allowedActions: ["post_status", "stay_silent"],
              resultArchivePolicy: { mode: "all_final_results" },
              authorityOrder: "default",
              entryBrief: "default",
              dispatchBrief: "default",
            })
          );
        });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceContractSet({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Space contract unchanged:");
      const spaceFetchCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes(`/spaces/${VALID_SPACE_ID}/contract`)
      );
      expect(spaceFetchCalls).toHaveLength(1);
    });
  });

  it("retries contract set with a prompted password in human view", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });
      passwordPromptMock.mockResolvedValue("secret-0321");

      let patchAttempt = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const profileResponse = createControlProfileApiResponse(input, init);
        if (profileResponse) {
          return resolveFetchResponse(profileResponse);
        }
        patchAttempt += 1;
        if (patchAttempt === 1) {
          return resolveFetchResponse(
            createJsonResponse(
              {
                ok: false,
                error: {
                  code: "space.password_required",
                  message: "space password required",
                },
              },
              401
            )
          );
        }
        return resolveFetchResponse(
          createJsonResponse({
            version: 2,
            updatedAt: "2026-03-21T00:01:00.000Z",
            updatedBy: PROFILE.openMeldProfileId,
            dispatchPolicy: { mode: "mention_only" },
            publicationMode: "collaboration",
            allowedActions: ["post_message", "post_status", "stay_silent"],
            resultArchivePolicy: { mode: "all_final_results" },
            authorityOrder: "default",
            entryBrief: "default",
            dispatchBrief: "none",
          })
        );
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceContractSet({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          dispatchBrief: "none",
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain(
        "This space is protected. Enter password to update the contract."
      );
      expect(passwordPromptMock).toHaveBeenCalledOnce();
    });
  });

  it("renders human-readable space status output", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              spaceId: VALID_SPACE_ID,
              generatedAt: "2026-03-21T00:03:00.000Z",
              name: "phase-5b-room",
              organizationVisibility: "private",
              accessMode: "protected",
              passwordProtected: true,
              dispatchPolicy: { mode: "mention_only" },
              publicationMode: "collaboration",
              allowedActions: ["post_message", "post_status", "stay_silent"],
              resultArchivePolicy: { mode: "all_final_results" },
              entryBrief: "default",
              dispatchBrief: "default",
              members: {
                totalCount: 3,
                humanCount: 1,
                agentCount: 2,
                liveNowCount: 2,
                liveHumanCount: 1,
                liveAgentCount: 1,
              },
              latestVisibleUpdate: {
                signalId: "sig-status-1",
                signalType: "signal.status",
                createdAt: "2026-03-21T00:02:30.000Z",
                actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
                actorName: "hi-agent",
                previewText: "Status update",
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceStatus({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Space status:");
      expect(plainStdout).toContain("Collaboration summary:");
      expect(plainStdout).toContain("Latest public activity:");
      expect(plainStdout).toContain("phase-5b-room");
      expect(plainStdout).toContain("Organization visibility");
      expect(plainStdout).toContain("invite only");
      expect(plainStdout).toContain("Link access");
      expect(plainStdout).toContain("password required to view and join");
      expect(plainStdout).toContain("Status update");
      expect(plainStdout).toContain("Connected agents");
      expect(plainStdout).not.toContain("Live agents");
    });
  });

  it("keeps link access readable when an older status response omits Organization visibility", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(
          createJsonResponse({
            spaceId: VALID_SPACE_ID,
            generatedAt: "2026-03-21T00:03:00.000Z",
            name: "phase-5b-room",
            accessMode: "public",
            passwordProtected: false,
            dispatchPolicy: { mode: "mention_only" },
            publicationMode: "collaboration",
            allowedActions: ["post_message", "post_status", "stay_silent"],
            resultArchivePolicy: { mode: "all_final_results" },
            entryBrief: "default",
            dispatchBrief: "default",
            members: {
              totalCount: 1,
              humanCount: 1,
              agentCount: 0,
              liveNowCount: 0,
              liveHumanCount: 0,
              liveAgentCount: 0,
            },
            latestVisibleUpdate: {
              signalId: "sig-status-long",
              signalType: "signal.text",
              createdAt: "2026-03-21T00:02:30.000Z",
              actorProfileId: HUMAN_PROFILE_ID,
              actorName: "Mira",
              previewText: `${"a".repeat(238)}😀tail-that-must-not-leak`,
            },
          })
        )
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceStatus({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Link access");
      expect(plainStdout).toContain("anyone with the link");
      expect(plainStdout).not.toContain("Organization visibility");
    });
  });

  it("keeps agent-view space status compact", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              spaceId: VALID_SPACE_ID,
              generatedAt: "2026-03-21T00:03:00.000Z",
              name: "phase-5b-room",
              organizationVisibility: "private",
              accessMode: "public",
              passwordProtected: false,
              dispatchPolicy: { mode: "mention_only" },
              publicationMode: "collaboration",
              allowedActions: ["post_message", "post_status", "stay_silent"],
              resultArchivePolicy: { mode: "all_final_results" },
              entryBrief: "default",
              dispatchBrief: "default",
              members: {
                totalCount: 3,
                humanCount: 1,
                agentCount: 2,
                liveNowCount: 2,
                liveHumanCount: 1,
                liveAgentCount: 1,
              },
              latestVisibleUpdate: {
                signalId: "sig-status-1",
                signalType: "signal.status",
                createdAt: "2026-03-21T00:02:30.000Z",
                actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
                actorName: "hi-agent",
                previewText: "Status update",
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
      );

      const { stdout, plainStdout } = await withCapturedStdio(async () => {
        await runSpaceStatus({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "agent",
        });
      });

      const envelope = JSON.parse(stdout.trim());
      expect(envelope).toMatchObject({
        type: "line",
        code: "space.status",
        text: "space status: phase-5b-room, members=3, agents=2",
        data: {
          spaceId: VALID_SPACE_ID,
          organizationVisibility: "private",
          accessMode: "public",
          members: {
            totalCount: 3,
            agentCount: 2,
          },
          latestVisibleUpdate: {
            signalId: "sig-status-1",
            previewText: "Status update",
          },
        },
      });
      expect(plainStdout).not.toContain("Space status:");
      expect(plainStdout).not.toContain("Collaboration summary:");
    });
  });

  it("emits canonical json for space status", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const profileResponse = createControlProfileApiResponse(input, init);
        if (profileResponse) {
          return resolveFetchResponse(profileResponse);
        }
        return resolveFetchResponse(
          createJsonResponse({
            spaceId: VALID_SPACE_ID,
            generatedAt: "2026-03-21T00:03:00.000Z",
            organizationVisibility: "private",
            accessMode: "public",
            passwordProtected: false,
            dispatchPolicy: { mode: "mention_only" },
            publicationMode: "collaboration",
            allowedActions: ["post_message", "post_status", "stay_silent"],
            resultArchivePolicy: { mode: "all_final_results" },
            entryBrief: "default",
            dispatchBrief: "default",
            members: {
              totalCount: 1,
              humanCount: 1,
              agentCount: 0,
              liveNowCount: 0,
              liveHumanCount: 0,
              liveAgentCount: 0,
            },
          })
        );
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceStatus({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: true,
          view: "human",
        });
      });

      expect(JSON.parse(stdout.trim())).toMatchObject({
        spaceId: VALID_SPACE_ID,
        organizationVisibility: "private",
        accessMode: "public",
        passwordProtected: false,
        latestVisibleUpdate: {
          previewText: `${"a".repeat(238)}…`,
        },
      });
    });
  });
});
