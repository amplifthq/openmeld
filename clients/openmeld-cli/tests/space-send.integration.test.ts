import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
} from "@openmeld/schemas/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import { setAuthSession } from "../src/config/auth-session";
import { runSend } from "../src/space/send";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

function createPostSignalResponse(text = "hello"): Response {
  return new Response(
    JSON.stringify({
      v: 1,
      id: "sig-1",
      spaceId: "demo",
      ts: 1,
      profile: {
        kind: "human",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileName: "Mira",
      },
      type: "signal.text",
      data: {
        text,
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

describe("space send OpenMeld profile identity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("falls back to disk profile identity when override fields are blank", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--send",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      const fetchMock = vi.fn(
        async (_request: string | URL, _init?: RequestInit) =>
          createPostSignalResponse()
      );
      vi.stubGlobal("fetch", fetchMock);

      await withCapturedStdio(async () => {
        await runSend({
          profile: "mira--send",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-0000-0000-0000-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          password: "pw-123456",
          text: "hello",
          view: "agent",
        });
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requestInit = fetchMock.mock.calls[0]?.[1] as
        | RequestInit
        | undefined;
      expect(requestInit).toBeDefined();
      const headers = (requestInit?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      expect(headers["x-openmeld-space-password"]).toBe("pw-123456");
      expect(headers["x-openmeld-profile-id"]).toBe(
        "aaaaaaaa-0000-0000-0000-000000000000"
      );
      expect(headers["x-openmeld-profile-name"]).toBe("Mira");
      const body = JSON.parse(String(requestInit?.body ?? "{}")) as {
        text?: string;
      };
      expect(body.text).toBe("hello");
    });
  });

  it("creates a thread and posts into it when --reply-to has no thread yet", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--reply",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      let createThreadCalled = false;
      let postThreadSignalCalled = false;
      const fetchMock = vi.fn((request: string | URL, init?: RequestInit) => {
        const url = String(request);
        const method = String(init?.method ?? "GET").toUpperCase();
        const isThreadSignals =
          url.includes("/threads/") && url.includes("/signals");
        const isThreads = url.includes("/threads") && !isThreadSignals;
        if (isThreads && method === "GET") {
          return Promise.resolve(
            new Response(JSON.stringify({ threads: [], previews: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (isThreads && method === "POST") {
          createThreadCalled = true;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                thread: {
                  threadId: "thr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                  spaceId: "demo",
                  rootSignalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  createdByProfileId: "aaaaaaaa-0000-0000-0000-000000000000",
                  createdAt: "2026-03-10T00:00:00.000Z",
                  updatedAt: "2026-03-10T00:00:00.000Z",
                },
                rootSignal: {
                  v: 1,
                  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  spaceId: "demo",
                  ts: 1,
                  profile: {
                    kind: "human",
                    profileId: "aaaaaaaa-0000-0000-0000-000000000000",
                    profileName: "Mira",
                  },
                  type: "signal.text",
                  data: { text: "root" },
                },
                placement: {
                  threadId: "thr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                  signalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  placement: "root",
                  createdAt: "2026-03-10T00:00:00.000Z",
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
          );
        }
        if (isThreadSignals && method === "POST") {
          postThreadSignalCalled = true;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signal: {
                  v: 1,
                  id: "thread-reply-1",
                  spaceId: "demo",
                  ts: 2,
                  profile: {
                    kind: "human",
                    profileId: "aaaaaaaa-0000-0000-0000-000000000000",
                    profileName: "Mira",
                  },
                  type: "signal.text",
                  data: { text: "reply into thread" },
                },
                placement: {
                  threadId: "thr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                  signalId: "thread-reply-1",
                  placement: "thread",
                  createdAt: "2026-03-10T00:00:00.000Z",
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
          );
        }
        throw new Error(`unexpected request: ${method} ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await withCapturedStdio(async () => {
        await runSend({
          profile: "mira--reply",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-0000-0000-0000-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "reply into thread",
          plainText: true,
          replyToSignalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          view: "agent",
        });
      });

      expect(createThreadCalled).toBe(true);
      expect(postThreadSignalCalled).toBe(true);
    });
  });

  it("adds Authorization header when logged in", async () => {
    const previousForceInsecureToken =
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await runInit({
          profile: "mira--send-auth",
          profileId: "aaaaaaaa-1111-2222-3333-000000000000",
          profileName: "Mira",
          kind: "human",
        });
        await setAuthSession({
          accessToken: "cli-token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
        });

        const fetchMock = vi.fn((request: string | URL, init?: RequestInit) => {
          const url = new URL(String(request));
          const method = String(init?.method ?? "GET").toUpperCase();
          if (
            method === "GET" &&
            url.toString() ===
              "https://auth.openmeld.invalid/api/auth/get-session"
          ) {
            return new Response(
              JSON.stringify({
                session: { active: true },
                user: { id: "user-1" },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            );
          }
          return createPostSignalResponse();
        });
        vi.stubGlobal("fetch", fetchMock);

        await withSilencedStdio(async () => {
          await runSend({
            profile: "mira--send-auth",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
              profileName: "Mira",
              profileKind: "human",
            }),
            baseUrl: "https://gateway.openmeld.invalid",
            space: "demo",
            text: "hello",
            view: "agent",
          });
        });

        const requestInit = findPostSignalRequestInit(fetchMock);
        const headers = (requestInit?.headers ?? {}) as Record<string, string>;
        expect(headers.Authorization ?? headers.authorization).toBe(
          "Bearer cli-token"
        );
      } finally {
        if (previousForceInsecureToken === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
          );
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN =
            previousForceInsecureToken;
        }
      }
    });
  });

  it("prints acting profile in human view for send auditability", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn(
        async (_request: string | URL, _init?: RequestInit) =>
          createPostSignalResponse()
      );
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "hum_operator",
            profileName: "Felix",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "hello",
          view: "human",
        });
      });

      expect(findLineEnvelope(stdout, "send.acting_profile")).toBeUndefined();
      expect(stdout).toContain("sender: hum_operator (human)");
    });
  });

  it("publishes typed canonical Wake input as a bare mention", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/members")) {
          return Promise.resolve(
            createMembersResponse({
              humans: [
                createHumanMember({
                  profileId: "aaaaaaaa-1111-2222-3333-000000000000",
                  profileName: "Mira",
                }),
                createHumanMember({
                  profileId: "bbbbbbbb-1111-2222-3333-000000000000",
                  profileName: "Jordan",
                }),
              ],
              agents: [
                createAgentMember({
                  profileId: "agt_11111111-2222-4333-8444-555555555555",
                  profileName: "Budget Analyst",
                  wakeabilityStatus: "ready",
                }),
              ],
            })
          );
        }

        if (method === "POST" && url.pathname.endsWith("/signals")) {
          return Promise.resolve(createPostSignalResponse());
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await withSilencedStdio(async () => {
        await runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "@Budget Analyst(wake) Please review the rollout plan with @Jordan(reference).",
          view: "human",
        });
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(parsePostSignalBody(fetchMock)).toMatchObject({
        text: "@Budget Analyst Please review the rollout plan with @Jordan.",
        meta: {
          clientMessageId: expect.any(String),
        },
        messageEnvelope: {
          activationTargets: ["agt_11111111-2222-4333-8444-555555555555"],
          referenceTargets: ["bbbbbbbb-1111-2222-3333-000000000000"],
          text: "@Budget Analyst Please review the rollout plan with @Jordan.",
        },
      });
      expect(
        parsePostSignalBody(fetchMock).meta?.clientMessageId?.trim()
      ).toBeTruthy();
    });
  });

  it("shows agent-view progress while resolving canonical mentions and posting", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/members")) {
          return Promise.resolve(
            createMembersResponse({
              humans: [
                createHumanMember({
                  profileId: "aaaaaaaa-1111-2222-3333-000000000000",
                  profileName: "Mira",
                }),
              ],
              agents: [
                createAgentMember({
                  profileId: "agt_11111111-2222-4333-8444-555555555555",
                  profileName: "Budget Analyst",
                  wakeabilityStatus: "ready",
                }),
              ],
            })
          );
        }

        if (method === "POST" && url.pathname.endsWith("/signals")) {
          return Promise.resolve(createPostSignalResponse());
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "@Budget Analyst(wake) Please propose the rollout plan.",
          view: "agent",
        });
      });

      expect(findLineEnvelope(stdout, "send.progress")?.data).toMatchObject({
        stage: "prepare_message",
      });
      expect(stdout).toContain('"stage":"load_members"');
      expect(stdout).toContain('"stage":"post_message"');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("sends canonical-looking mention text literally when plainText is enabled", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "POST" && url.pathname.endsWith("/signals")) {
          return Promise.resolve(createPostSignalResponse());
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          plainText: true,
          text: "Debug note: @Budget Analyst(wake) was shown as text.",
          view: "agent",
        });
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(parsePostSignalBody(fetchMock)).toMatchObject({
        text: "Debug note: @Budget Analyst(wake) was shown as text.",
      });
      expect(parsePostSignalBody(fetchMock)).not.toHaveProperty(
        "messageEnvelope"
      );
      expect(stdout).not.toContain('"stage":"load_members"');
      expect(findLineEnvelope(stdout, "space.send.addressing_summary")).toEqual(
        expect.objectContaining({
          data: {
            referenceTargetCount: 0,
            wakeTargetCount: 0,
          },
        })
      );
    });
  });

  it("keeps unknown @tokens as plain text for human one-shot send", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn(
        async (_request: string | URL, _init?: RequestInit) =>
          createPostSignalResponse()
      );
      vi.stubGlobal("fetch", fetchMock);

      await withSilencedStdio(async () => {
        await runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "@budget-analyst stays plain text.",
          view: "human",
        });
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(parsePostSignalBody(fetchMock)).toMatchObject({
        text: "@budget-analyst stays plain text.",
      });
      expect(parsePostSignalBody(fetchMock)).not.toHaveProperty(
        "messageEnvelope"
      );
    });
  });

  it("warns when a bare @member mention does not create Space addressing targets", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/members")) {
          return Promise.resolve(
            createMembersResponse({
              humans: [
                createHumanMember({
                  profileId: "aaaaaaaa-1111-2222-3333-000000000000",
                  profileName: "Mira",
                }),
              ],
              agents: [
                createAgentMember({
                  profileId: "agt_11111111-2222-4333-8444-555555555555",
                  profileName: "Budget Analyst",
                  wakeabilityStatus: "ready",
                }),
              ],
            })
          );
        }

        if (method === "POST" && url.pathname.endsWith("/signals")) {
          return Promise.resolve(createPostSignalResponse());
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "Please ask @Budget Analyst to review this.",
          view: "agent",
        });
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(parsePostSignalBody(fetchMock)).toMatchObject({
        text: "Please ask @Budget Analyst to review this.",
      });
      expect(parsePostSignalBody(fetchMock)).not.toHaveProperty(
        "messageEnvelope"
      );
      expect(findLineEnvelope(stdout, "space.send.addressing_summary")).toEqual(
        expect.objectContaining({
          data: {
            referenceTargetCount: 0,
            wakeTargetCount: 0,
          },
          text: "Space Message Addressing: wake=0, reference=0.",
        })
      );
      const warning = findLineEnvelope(
        stdout,
        "space.send.bare_mention_warning"
      );
      expect(warning?.text).toContain(
        "Bare mention @Budget Analyst is plain text and does not create a Wake."
      );
      expect(warning?.text).toContain("@Budget Analyst(wake)");
      expect(warning?.data).toMatchObject({
        mentions: [
          {
            mentionText: "@Budget Analyst",
            profileId: "agt_11111111-2222-4333-8444-555555555555",
            suggestedWakeText: "@Budget Analyst(wake)",
          },
        ],
      });
    });
  });

  it("warns only for bare @mentions when canonical mentions are present", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/members")) {
          return Promise.resolve(
            createMembersResponse({
              humans: [
                createHumanMember({
                  profileId: "aaaaaaaa-1111-2222-3333-000000000000",
                  profileName: "Mira",
                }),
              ],
              agents: [
                createAgentMember({
                  profileId: "agt_11111111-2222-4333-8444-555555555555",
                  profileName: "Budget Analyst",
                  wakeabilityStatus: "ready",
                }),
              ],
            })
          );
        }

        if (method === "POST" && url.pathname.endsWith("/signals")) {
          return Promise.resolve(createPostSignalResponse());
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "@Budget Analyst(wake) and @Budget Analyst should only warn once.",
          view: "agent",
        });
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(parsePostSignalBody(fetchMock)).toMatchObject({
        messageEnvelope: {
          activationTargets: ["agt_11111111-2222-4333-8444-555555555555"],
          referenceTargets: [],
          text: "@Budget Analyst and @Budget Analyst should only warn once.",
        },
      });
      const warning = findLineEnvelope(
        stdout,
        "space.send.bare_mention_warning"
      );
      const warningData = warning?.data as { mentions?: unknown[] } | undefined;
      expect(
        Array.isArray(warningData?.mentions) ? warningData.mentions : []
      ).toHaveLength(1);
      expect(warning?.data).toMatchObject({
        mentions: [
          {
            mentionText: "@Budget Analyst",
            profileId: "agt_11111111-2222-4333-8444-555555555555",
          },
        ],
      });
    });
  });

  it("preserves members snapshot failure context for canonical one-shot mention validation", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/members")) {
          return Promise.reject(
            new Error(
              "request failed for members lookup (request ID: req-members-1)"
            )
          );
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "@Budget Analyst(wake) Please propose the rollout plan.",
          view: "human",
        })
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          "OpenMeld couldn't check who your mentions refer to."
        ),
        cause: expect.objectContaining({
          message:
            "request failed for members lookup (request ID: req-members-1)",
        }),
      });
      await expect(
        runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "@Budget Analyst(wake) Please propose the rollout plan.",
          view: "human",
        })
      ).rejects.toThrow("Use --plain");
    });
  });

  it("preserves gateway code and requestId when send fails", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "space.not_found",
                message: "Space not found.",
                requestId: "req-send-404",
              },
            }),
            {
              status: 404,
              headers: {
                "content-type": "application/json",
                "x-openmeld-request-id": "req-send-404",
              },
            }
          )
        )
      );
      vi.stubGlobal("fetch", fetchMock);

      for (const view of ["human", "agent"] as const) {
        await expect(
          runSend({
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "hum_operator",
              profileName: "Felix",
              profileKind: "human",
            }),
            baseUrl: "https://gateway.openmeld.invalid",
            space: "demo",
            text: "hello",
            view,
          })
        ).rejects.toMatchObject({
          code: "space.not_found",
          requestId: "req-send-404",
          message: "Space not found.",
        });
      }
    });
  });

  it("keeps plain human one-shot send free of empty message envelopes", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn(
        async (_request: string | URL, _init?: RequestInit) =>
          createPostSignalResponse()
      );
      vi.stubGlobal("fetch", fetchMock);

      await withSilencedStdio(async () => {
        await runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "hello plain human send",
          view: "human",
        });
      });

      expect(parsePostSignalBody(fetchMock)).toMatchObject({
        text: "hello plain human send",
      });
      expect(parsePostSignalBody(fetchMock)).not.toHaveProperty(
        "messageEnvelope"
      );
    });
  });

  it("keeps bare @tokens as plain text for human one-shot send", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn(
        async (_request: string | URL, _init?: RequestInit) =>
          createPostSignalResponse()
      );
      vi.stubGlobal("fetch", fetchMock);

      await withSilencedStdio(async () => {
        await runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "@unknown-token stays plain text",
          view: "human",
        });
      });

      expect(parsePostSignalBody(fetchMock)).toMatchObject({
        text: "@unknown-token stays plain text",
      });
      expect(parsePostSignalBody(fetchMock)).not.toHaveProperty(
        "messageEnvelope"
      );
    });
  });

  it("rejects invalid typed canonical mentions for human one-shot send before posting", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/members")) {
          return Promise.resolve(
            createMembersResponse({
              humans: [
                createHumanMember({
                  profileId: "aaaaaaaa-1111-2222-3333-000000000000",
                  profileName: "Mira",
                }),
              ],
              agents: [],
            })
          );
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "@budget analyst(wake) Please propose the rollout plan.",
          view: "human",
        })
      ).rejects.toThrow(
        "That mention does not match a current member. Type @ and choose a member from the list."
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("rejects invalid canonical mention syntax before loading members", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "@NameWith(Bracket)(wake) Please propose the rollout plan.",
          view: "human",
        })
      ).rejects.toThrow(
        "That mention is not valid. Type @ and choose a member from the list."
      );

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("rejects removed CC syntax before loading members", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "@Mira(cc) Please review.",
          view: "human",
        })
      ).rejects.toThrow(
        "CC has been removed from Space Message Addressing. Use Reference instead."
      );

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("rejects removed CC syntax even when --plain bypasses mention parsing", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          plainText: true,
          space: "demo",
          text: "@Mira(cc) Please review.",
          view: "human",
        })
      ).rejects.toThrow(
        "CC has been removed from Space Message Addressing. Use Reference instead."
      );

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("preserves upstream fake-space failures for canonical mention preflight", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/members")) {
          return Promise.resolve(
            createGatewayFailureResponse({
              code: "space.not_found",
              message: "Space not found.",
              requestId: "req-members-404",
              status: 404,
            })
          );
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
            profileName: "Mira",
            profileKind: "human",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "@Budget Analyst(wake) Please propose the rollout plan.",
          view: "human",
        })
      ).rejects.toMatchObject({
        code: "space.not_found",
        requestId: "req-members-404",
        message: "Space not found.",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("validates canonical mentions for agent one-shot send before posting", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/members")) {
          return Promise.resolve(
            createMembersResponse({
              humans: [],
              agents: [
                createAgentMember({
                  profileId: "agt_aaaaaaaa-1111-4222-8333-000000000000",
                  profileName: "Ops Bot",
                  wakeabilityStatus: "ready",
                }),
                createAgentMember({
                  profileId: "agt_11111111-2222-4333-8444-555555555555",
                  profileName: "Budget Analyst",
                  wakeabilityStatus: "ready",
                }),
              ],
            })
          );
        }

        if (method === "POST" && url.pathname.endsWith("/signals")) {
          return Promise.resolve(createPostSignalResponse());
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await withSilencedStdio(async () => {
        await runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "agt_aaaaaaaa-1111-4222-8333-000000000000",
            profileName: "Ops Bot",
            profileKind: "agent",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "@Budget Analyst(wake) Leave this untouched.",
          view: "agent",
        });
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(parsePostSignalBody(fetchMock)).toMatchObject({
        meta: {
          clientMessageId: expect.any(String),
        },
        messageEnvelope: {
          activationTargets: ["agt_11111111-2222-4333-8444-555555555555"],
          referenceTargets: [],
          text: "@Budget Analyst Leave this untouched.",
        },
      });
      expect(
        parsePostSignalBody(fetchMock).meta?.clientMessageId?.trim()
      ).toBeTruthy();
    });
  });

  it("accepts blocked-readiness canonical wake targets for agent one-shot send", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/members")) {
          return Promise.resolve(
            createMembersResponse({
              humans: [],
              agents: [
                createAgentMember({
                  profileId: "agt_aaaaaaaa-1111-4222-8333-000000000000",
                  profileName: "Ops Bot",
                  wakeabilityStatus: "ready",
                }),
                createAgentMember({
                  profileId: "agt_11111111-2222-4333-8444-555555555555",
                  profileName: "Blocked Agent",
                  wakeabilityStatus: "blocked",
                }),
              ],
            })
          );
        }

        if (method === "POST" && url.pathname.endsWith("/signals")) {
          return Promise.resolve(createPostSignalResponse());
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await withSilencedStdio(async () => {
        await runSend({
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "agt_aaaaaaaa-1111-4222-8333-000000000000",
            profileName: "Ops Bot",
            profileKind: "agent",
          }),
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          text: "@Blocked Agent(wake) keep this structured.",
          view: "agent",
        });
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/members"),
        expect.any(Object)
      );
      expect(parsePostSignalBody(fetchMock)).toMatchObject({
        text: "@Blocked Agent keep this structured.",
        meta: {
          clientMessageId: expect.any(String),
        },
        messageEnvelope: {
          activationTargets: ["agt_11111111-2222-4333-8444-555555555555"],
          referenceTargets: [],
          text: "@Blocked Agent keep this structured.",
        },
      });
      expect(
        parsePostSignalBody(fetchMock).meta?.clientMessageId?.trim()
      ).toBeTruthy();
    });
  });
});

function createOpenMeldProfileInput(input: {
  openMeldProfileId: string;
  profileName: string;
  profileKind: "human" | "agent" | "system";
}) {
  return createTestOpenMeldProfile({
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.profileName,
    profileKind: input.profileKind,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  });
}

function createMembersResponse(input: {
  humans: ReturnType<typeof createHumanMember>[];
  agents: ReturnType<typeof createAgentMember>[];
}): Response {
  const { humans, agents } = input;

  return new Response(
    JSON.stringify({
      spaceId: "demo",
      generatedAt: "2026-04-01T00:00:00.000Z",
      summary: {
        totalCount: humans.length + agents.length,
        humanCount: humans.length,
        agentCount: agents.length,
        liveNowCount: 0,
      },
      humans,
      agents,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

function createGatewayFailureResponse(input: {
  code: string;
  message: string;
  requestId: string;
  status: number;
}): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: input.code,
        message: input.message,
        requestId: input.requestId,
      },
    }),
    {
      status: input.status,
      headers: {
        "content-type": "application/json",
        "x-openmeld-request-id": input.requestId,
      },
    }
  );
}

function createHumanMember(input: { profileId: string; profileName: string }) {
  return createSpaceMemberHumanSnapshot({
    addedAt: "2026-04-01T00:00:00.000Z",
    createdAt: "2026-04-01T00:00:00.000Z",
    firstEnteredAt: "2026-04-01T00:00:00.000Z",
    lastEnteredAt: "2026-04-01T00:00:00.000Z",
    lastSeenAt: "2026-04-01T00:00:00.000Z",
    lastSeenLabel: "Seen just now",
    liveNow: false,
    ownerName: null,
    ownerUserId: null,
    profileId: input.profileId,
    profileName: input.profileName,
    updatedAt: "2026-04-01T00:00:00.000Z",
  });
}

function createAgentMember(input: {
  profileId: string;
  profileName: string;
  wakeabilityStatus: "ready" | "blocked";
}) {
  return createSpaceMemberAgentSnapshot({
    addedAt: "2026-04-01T00:00:00.000Z",
    addedByDisplayName: "Mira",
    addedByOwnerUserId: null,
    addedByProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
    createdAt: "2026-04-01T00:00:00.000Z",
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: "2026-04-01T00:00:00.000Z",
    lastSeenLabel: "Seen just now",
    liveNow: false,
    memberSourceLabel: "Added by Mira",
    ownerName: null,
    ownerUserId: null,
    profileId: input.profileId,
    profileName: input.profileName,
    updatedAt: "2026-04-01T00:00:00.000Z",
    wakeabilityReasonText:
      input.wakeabilityStatus === "blocked"
        ? "Wake is currently blocked in Space"
        : undefined,
    wakeabilityStatus: input.wakeabilityStatus,
  });
}

function parsePostSignalBody(fetchMock: ReturnType<typeof vi.fn>): {
  meta?: {
    clientMessageId?: string;
  };
  messageEnvelope?: {
    activationTargets?: string[];
    referenceTargets?: string[];
    text?: string;
  };
  text?: string;
} {
  const requestInit = fetchMock.mock.calls.at(-1)?.[1] as
    | RequestInit
    | undefined;
  return JSON.parse(String(requestInit?.body ?? "{}")) as {
    meta?: {
      clientMessageId?: string;
    };
    messageEnvelope?: {
      activationTargets?: string[];
      referenceTargets?: string[];
      text?: string;
    };
    text?: string;
  };
}

function findPostSignalRequestInit(
  fetchMock: ReturnType<typeof vi.fn>
): RequestInit | undefined {
  return fetchMock.mock.calls.find(([request, init]) => {
    const method = String((init as RequestInit | undefined)?.method ?? "GET")
      .trim()
      .toUpperCase();
    return method === "POST" && String(request).includes("/signals");
  })?.[1] as RequestInit | undefined;
}

function findLineEnvelope(
  stdout: string,
  code: string
): { text?: string; data?: Record<string, unknown> } | undefined {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        code?: string;
        text?: string;
        data?: Record<string, unknown>;
      };
      if (parsed.type === "line" && parsed.code === code) {
        return {
          ...(typeof parsed.text === "string" ? { text: parsed.text } : {}),
          ...(parsed.data ? { data: parsed.data } : {}),
        };
      }
    } catch {
      // Ignore plain-text lines in human view output.
    }
  }

  return undefined;
}
