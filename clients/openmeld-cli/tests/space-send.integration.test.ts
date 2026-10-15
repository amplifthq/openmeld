import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID } from "@openmeld/gateway-contract";
import { buildTargetWakeLifecycleId } from "@openmeld/schemas";
import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
} from "@openmeld/schemas/testing";
import type {
  GetSpaceMessageDetailsResponse,
  OpenDirectMessageSpaceBody,
  OpenDirectMessageSpaceResponse,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import { setAuthSession } from "../src/config/auth-session";
import { runDirectMessage } from "../src/space/direct-message";
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

  it("opens a DM before exposing a stoppable receipt and pins the send and retry to that conversation", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "cli-token",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "user-1" },
      });
      const profile = createTestOpenMeldProfile({
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Writer",
      });
      const targetProfileId = "agt_22222222-2222-4222-8222-222222222222";
      const clientMessageId = "33333333-3333-4333-8333-333333333333";
      const opened: OpenDirectMessageSpaceResponse = {
        organizationId: "org-opened",
        memberProfileId: profile.openMeldProfileId,
        targetProfileId,
        spaceId: "fixed-dm",
        created: true,
      };
      const requests: OpenDirectMessageSpaceBody[] = [];
      let stdoutBeforeSend = "";
      vi.stubGlobal(
        "fetch",
        vi.fn((request: string | URL, init?: RequestInit) => {
          const url = new URL(String(request));
          if (url.pathname === "/api/auth/get-session") {
            return Response.json({
              session: { active: true },
              user: { id: "user-1" },
            });
          }
          if (url.pathname === "/v1/profiles/resolve") {
            return Response.json({ ok: true, profile });
          }
          expect(url.pathname).toBe("/v1/organizations/current/dm-space");
          const body = JSON.parse(
            String(init?.body)
          ) as OpenDirectMessageSpaceBody;
          requests.push(body);
          if (!body.message) {
            expect(stdoutBeforeSend).not.toContain("space.send.request");
            return Response.json(opened);
          }
          // The receipt must exist while the publication request is still pending.
          expect(
            findLineEnvelope(stdoutBeforeSend, "space.send.request")
          ).toMatchObject({
            data: {
              spaceId: "fixed-dm",
              profileId: profile.openMeldProfileId,
              clientMessageId,
              targetProfileIds: [targetProfileId],
            },
          });
          expect(body.spaceId).toBe("fixed-dm");
          expect(body.creationId).toBeUndefined();
          if (requests.length === 2) {
            expect(
              new Headers(init?.headers).get(
                OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID
              )
            ).toBe("org-opened");
          }
          const response: OpenDirectMessageSpaceResponse = {
            ...opened,
            created: false,
            signal: {
              v: 1,
              id: "sig-dm",
              spaceId: "fixed-dm",
              ts: 1,
              profile: {
                kind: "agent",
                profileId: profile.openMeldProfileId,
                profileName: "Writer",
              },
              type: "signal.text",
              data: { text: body.message.text, meta: { clientMessageId } },
            },
          };
          return Response.json(response);
        })
      );
      const input = {
        targetProfileId,
        profile: profile.openMeldProfileId,
        clientMessageId,
        text: "Please review this.",
        wake: true,
        view: "agent",
        baseUrl: "https://gateway.openmeld.invalid",
      };
      for (const spaceId of [undefined, "fixed-dm"]) {
        stdoutBeforeSend = "";
        await withCapturedStdio(() => runDirectMessage({ ...input, spaceId }), {
          onStdout: (text) => {
            stdoutBeforeSend += text;
          },
        });
      }
      expect(requests).toHaveLength(3);
      expect(requests[0]).toEqual({ targetProfileId });
      expect(requests[1]).toEqual(requests[2]);
    });
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

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSend({
          clientMessageId: "chosen-before-send",
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
      expect(plainStdout).toContain("space.send.request");
      expect(plainStdout.indexOf("chosen-before-send")).toBeLessThan(
        plainStdout.indexOf("send.response")
      );
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
        meta?: { clientMessageId: string };
      };
      expect(body.text).toBe("hello");
      expect(body.meta?.clientMessageId).toBe("chosen-before-send");
    });
  });

  it.each([
    "unthreaded",
    "root",
    "reply",
    "unsupported",
    "denied",
  ] as const)("resolves --reply-to from canonical message placement (%s)", async (placement) => {
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
        if (url.includes("/message-details") && method === "GET") {
          expect(new URL(url).searchParams.get("includeThreadContext")).toBe(
            "true"
          );
          expect(new URL(url).searchParams.get("signalId")).toBe(
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          );
          if (placement === "denied") {
            return Promise.resolve(
              Response.json(
                { error: { code: "forbidden", message: "Access denied" } },
                { status: 403 }
              )
            );
          }
          return Promise.resolve(Response.json(replyMessageDetails(placement)));
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
          expect(url).toContain(
            "/threads/thr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/signals"
          );
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

      const send = () =>
        withCapturedStdio(async () => {
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
      if (placement === "unsupported" || placement === "denied") {
        await expect(send()).rejects.toThrow(
          placement === "unsupported" ? "cannot resolve" : "Access denied"
        );
        expect(createThreadCalled).toBe(false);
        expect(postThreadSignalCalled).toBe(false);
      } else {
        await send();
        expect(createThreadCalled).toBe(placement === "unthreaded");
        expect(postThreadSignalCalled).toBe(true);
      }
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

  it.each([
    { mode: undefined, source: "none" },
    { mode: "resume", source: "request" },
    { mode: "resume", source: "reply" },
    { mode: "fork", source: "reply" },
    { mode: "resume", source: "missing" },
    { mode: "resume", source: "other-agent" },
  ] as const)("selects $mode from $source before publishing", async ({
    mode,
    source,
  }) => {
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

        if (method === "GET" && url.pathname.endsWith("/message-details")) {
          const details = replyMessageDetails("unthreaded");
          details.wakeContext = {
            state: "recorded",
            sourceSignalId:
              source === "missing"
                ? { state: "not_recorded", value: null, source: "none" }
                : {
                    state: "recorded",
                    value:
                      source === "request"
                        ? details.message.signalId
                        : "original-request",
                    source: "space_signal",
                  },
            clientMessageId: {
              state: "not_recorded",
              value: null,
              source: "none",
            },
            targets: [
              {
                targetProfileId:
                  source === "other-agent"
                    ? "agt_99999999-2222-4333-8444-555555555555"
                    : "agt_11111111-2222-4333-8444-555555555555",
                targetLabel: "Budget Analyst",
              },
            ],
          };
          return Promise.resolve(Response.json(details));
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const send = () =>
        withSilencedStdio(async () => {
          await runSend({
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "aaaaaaaa-1111-2222-3333-000000000000",
              profileName: "Mira",
              profileKind: "human",
            }),
            baseUrl: "https://gateway.openmeld.invalid",
            space: "demo",
            wakeTargets: ["agt_11111111-2222-4333-8444-555555555555"],
            ...(mode
              ? {
                  contextSelection: {
                    mode,
                    sourceWakeId: "unresolved-message-selection",
                  },
                  contextSourceSignalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                }
              : {}),
            mentionTargets: ["bbbbbbbb-1111-2222-3333-000000000000"],
            text: "Please review the rollout plan.",
            view: "human",
          });
        });

      if (source === "missing" || source === "other-agent") {
        await expect(send()).rejects.toThrow("No message was sent.");
        expect(
          fetchMock.mock.calls.every(
            ([, init]) => !init?.method || init.method === "GET"
          )
        ).toBe(true);
        return;
      }
      await send();
      expect(fetchMock).toHaveBeenCalledTimes(mode ? 3 : 2);
      if (mode) {
        expect(parsePostSignalBody(fetchMock)).toMatchObject({
          contextSelection: {
            mode,
            sourceWakeId: buildTargetWakeLifecycleId({
              spaceId: "demo",
              sourceSignalId:
                source === "request"
                  ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
                  : "original-request",
              targetProfileId: "agt_11111111-2222-4333-8444-555555555555",
            }),
          },
        });
      }
      expect(parsePostSignalBody(fetchMock)).toMatchObject({
        text: "@Budget Analyst @Jordan Please review the rollout plan.",
        meta: {
          clientMessageId: expect.any(String),
        },
        messageEnvelope: {
          activationTargets: ["agt_11111111-2222-4333-8444-555555555555"],
          mentionTargets: ["bbbbbbbb-1111-2222-3333-000000000000"],
          referenceTargets: [],
          text: "@Budget Analyst @Jordan Please review the rollout plan.",
        },
      });
      expect(
        parsePostSignalBody(fetchMock).meta?.clientMessageId?.trim()
      ).toBeTruthy();
    });
  });

  it.each([
    "hosted:center-agent",
    "hosted:remote-agent",
  ])("rejects session selection for %s before any upload or message write", async (agentControllerRef) => {
    await withTempHome(async (home) => {
      const filePath = join(home, "review.txt");
      await writeFile(filePath, "Review evidence");
      const profileId = "agt_11111111-2222-4333-8444-555555555555";
      const fetchMock = vi.fn((request: string | URL, init?: RequestInit) => {
        expect(String(init?.method ?? "GET").toUpperCase()).toBe("GET");
        expect(new URL(String(request)).pathname.endsWith("/members")).toBe(
          true
        );
        return Promise.resolve(
          createMembersResponse({
            humans: [],
            agents: [
              {
                ...createAgentMember({
                  profileId,
                  profileName: "Review Agent",
                  wakeabilityStatus: "ready",
                }),
                agentControllerRef,
              },
            ],
          })
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      await withCapturedStdio(async () => {
        await expect(
          runSend({
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "hum_operator",
              profileName: "Felix",
              profileKind: "human",
            }),
            baseUrl: "https://gateway.openmeld.invalid",
            space: "demo",
            text: "Read the review evidence",
            wakeTargets: [profileId],
            contextSelection: { mode: "new" },
            filePaths: [filePath],
            view: "agent",
          })
        ).rejects.toThrow("does not support session selection");
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });

  it("sends profile-id mention text literally when plainText is enabled", async () => {
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

      const literalText =
        "Debug note: @bbbbbbbb-1111-4222-8333-000000000000(mention) and @agt_11111111-2222-4333-8444-555555555555(wake) were shown as text.";
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
          text: literalText,
          view: "agent",
        });
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(parsePostSignalBody(fetchMock)).toMatchObject({
        text: literalText,
      });
      expect(parsePostSignalBody(fetchMock)).not.toHaveProperty(
        "messageEnvelope"
      );
      expect(stdout).not.toContain('"stage":"load_members"');
      expect(findLineEnvelope(stdout, "space.send.addressing_summary")).toEqual(
        expect.objectContaining({
          data: {
            mentionTargetCount: 0,
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

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(parsePostSignalBody(fetchMock)).toMatchObject({
        text: "@budget-analyst stays plain text.",
      });
      expect(parsePostSignalBody(fetchMock)).not.toHaveProperty(
        "messageEnvelope"
      );
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

  it("accepts blocked-readiness explicit Wake targets for agent one-shot send", async () => {
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
          wakeTargets: ["agt_11111111-2222-4333-8444-555555555555"],
          text: "keep this structured.",
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

function replyMessageDetails(
  placement: "unthreaded" | "root" | "reply" | "unsupported"
): GetSpaceMessageDetailsResponse {
  const absent = {
    state: "not_applicable",
    value: null,
    source: "none",
  } as const;
  const signalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  return {
    query: { spaceId: "demo", signalId },
    message: {
      signalId,
      signalType: "signal.text",
      sentAtMs: 1,
      actor: {
        profileId: "aaaaaaaa-0000-0000-0000-000000000000",
        profileKind: "human",
        displayName: "Mira",
        profileName: "Mira",
        profileHandle: null,
      },
    },
    agentContext: {
      state: "not_applicable",
      profileId: absent,
      profileName: absent,
      agentControllerRef: absent,
      agentControllerConversationId: absent,
      workspacePath: absent,
      openMeldServiceRuntimeId: absent,
      bindingId: absent,
      workspaceFingerprint: absent,
    },
    wakeContext: {
      state: "not_applicable",
      sourceSignalId: absent,
      clientMessageId: absent,
      targets: [],
    },
    replyContext: {
      state: "not_applicable",
      replyingToSignalId: absent,
      replyingToAuthor: absent,
      previewText: absent,
      resolved: false,
    },
    diagnostics: { signalId, traceSelectors: [] },
    ...(placement === "unsupported"
      ? {}
      : {
          threadContext:
            placement === "unthreaded"
              ? null
              : {
                  threadId: "thr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                  rootSignalId:
                    placement === "root"
                      ? signalId
                      : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                },
        }),
  };
}

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

function createHumanMember(input: {
  mentionAlias?: string;
  profileId: string;
  profileName: string;
}) {
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
    mentionAlias: input.mentionAlias ?? null,
    profileId: input.profileId,
    profileName: input.profileName,
    updatedAt: "2026-04-01T00:00:00.000Z",
  });
}

function createAgentMember(input: {
  mentionAlias?: string;
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
    mentionAlias: input.mentionAlias ?? null,
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
    mentionTargets?: string[];
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
      mentionTargets?: string[];
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
