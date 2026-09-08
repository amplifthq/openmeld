import { describe, expect, it, vi } from "vitest";
import {
  findSlackThreadMessageByMetadata,
  getSlackMessagePermalink,
  listSlackChannelMemberIds,
  listSlackChannels,
  listSlackWorkspaceMembers,
  openSlackDirectMessage,
  openSlackModal,
  postSlackChannelMessageByName,
  postSlackDirectMessage,
  postSlackFile,
  postSlackThreadMessage,
  readSlackChannelHistory,
  readSlackConversationInfo,
  readSlackFile,
  readSlackMessageByTimestamp,
  readSlackThreadMessages,
  resolveSlackConversationMessageTargetById,
  setSlackThreadStatus,
  updateSlackModal,
} from "../src/remote-agent/application/slack-client";

// Mirrors the view identity Slack documents in successful views.open and
// views.update responses: https://docs.slack.dev/reference/methods/views.open/
const SLACK_MODAL_SUCCESS_RESPONSE = {
  ok: true,
  view: {
    hash: "1569262015.55b5e41b",
    id: "VMHU10V25",
    type: "modal",
  },
} as const;

describe("Slack modal presentation", () => {
  it("returns the opened view identity needed for a race-safe update", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(SLACK_MODAL_SUCCESS_RESPONSE))
    );
    const view = {
      blocks: [],
      close: { text: "Cancel", type: "plain_text" },
      title: { text: "OpenMeld", type: "plain_text" },
      type: "modal",
    };

    await expect(
      openSlackModal({
        botToken: "xoxb-test",
        fetchImpl: fetchMock,
        triggerId: "trigger-1",
        view,
      })
    ).resolves.toEqual({
      hash: "1569262015.55b5e41b",
      viewId: "VMHU10V25",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      trigger_id: "trigger-1",
      view,
    });
  });

  it("updates the opened view by id and hash", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(SLACK_MODAL_SUCCESS_RESPONSE))
    );
    const view = {
      blocks: [],
      close: { text: "Close", type: "plain_text" },
      title: { text: "OpenMeld", type: "plain_text" },
      type: "modal",
    };

    await expect(
      updateSlackModal({
        botToken: "xoxb-test",
        fetchImpl: fetchMock,
        hash: "1569262015.55b5e41b",
        view,
        viewId: "VMHU10V25",
      })
    ).resolves.toEqual({ hash: "1569262015.55b5e41b" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      hash: "1569262015.55b5e41b",
      view,
      view_id: "VMHU10V25",
    });
  });
});

describe("Slack conversation audience", () => {
  it("classifies a nameless Slack DM without discarding its audience facts", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({ channel: { id: "D123", is_im: true }, ok: true })
      )
    );

    await expect(
      readSlackConversationInfo({
        botToken: "xoxb-test",
        channelId: "D123",
        fetchImpl: fetchMock,
      })
    ).resolves.toEqual({
      channelName: null,
      interactionEnvironment: "requester_private",
    });
  });

  it("fails an incomplete Slack conversation payload to an external audience", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ok: true }))
    );

    await expect(
      readSlackConversationInfo({
        botToken: "xoxb-test",
        channelId: "C_UNKNOWN",
        fetchImpl: fetchMock,
      })
    ).resolves.toEqual({
      channelName: null,
      interactionEnvironment: "externally_shared",
    });
  });

  it.each([
    {
      channel: { is_im: true, is_private: true, name: "directmessage" },
      expected: "requester_private",
      label: "direct message",
    },
    {
      channel: {
        is_ext_shared: true,
        is_im: true,
        is_shared: true,
        name: "external-direct-message",
      },
      expected: "externally_shared",
      label: "Slack Connect direct message",
    },
    {
      channel: { is_private: true, name: "leadership" },
      expected: "organization_shared",
      label: "internal private channel",
    },
    {
      channel: {
        is_ext_shared: true,
        is_shared: true,
        name: "partner-launch",
      },
      expected: "externally_shared",
      label: "Slack Connect channel",
    },
    {
      channel: {
        is_org_shared: true,
        is_shared: true,
        name: "enterprise-launch",
      },
      expected: "organization_shared",
      label: "Enterprise organization channel",
    },
    {
      channel: { is_shared: true, name: "unknown-shared" },
      expected: "externally_shared",
      label: "ambiguous shared channel",
    },
  ])("classifies a $label from Slack conversation facts", async (input) => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ channel: input.channel, ok: true }))
    );

    await expect(
      readSlackConversationInfo({
        botToken: "xoxb-test",
        channelId: "C123",
        fetchImpl: fetchMock,
      })
    ).resolves.toEqual({
      channelName: input.channel.name,
      interactionEnvironment: input.expected,
    });
  });
});

// Mirrors Slack's documented chat.postMessage response, including the complete
// server-parsed message shape: https://docs.slack.dev/reference/methods/chat.postMessage/#response
const SLACK_CHAT_POST_MESSAGE_SUCCESS_RESPONSE = {
  channel: "C123ABC456",
  message: {
    attachments: [
      {
        fallback: "This is an attachment's fallback",
        id: 1,
        text: "This is an attachment",
      },
    ],
    bot_id: "B123ABC456",
    subtype: "bot_message",
    text: "Here's a message for you",
    ts: "1503435956.000247",
    type: "message",
    username: "ecto1",
  },
  ok: true,
  ts: "1503435956.000247",
} as const;

// Slack documents invalid_blocks as a chat.postMessage Web API error code.
const SLACK_INVALID_BLOCKS_RESPONSE = {
  error: "invalid_blocks",
  ok: false,
} as const;

describe("Slack direct messages", () => {
  it("opens a writable direct-message conversation for one Slack user", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({ channel: { id: "D_OPENMELD" }, ok: true })
      )
    );

    await expect(
      openSlackDirectMessage({
        botToken: "xoxb-test",
        fetchImpl: fetchMock,
        recipientUserId: "U_INSTALLER",
      })
    ).resolves.toEqual({ channelId: "D_OPENMELD" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/conversations.open",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      users: ["U_INSTALLER"],
    });
  });

  it("posts Block Kit content to the recipient's Slack user ID", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(SLACK_CHAT_POST_MESSAGE_SUCCESS_RESPONSE))
    );
    const blocks = [
      {
        text: { text: "Welcome to OpenMeld.", type: "mrkdwn" },
        type: "section",
      },
      {
        elements: [
          {
            action_id: "open_openmeld_github_settings",
            text: { text: "Connect GitHub", type: "plain_text" },
            type: "button",
            url: "https://openmeld.test/o/acme/center-agent/plugins/github",
          },
        ],
        type: "actions",
      },
    ] as const;

    await expect(
      postSlackDirectMessage({
        blocks,
        botToken: "xoxb-test",
        fetchImpl: fetchMock,
        recipientUserId: "U_INSTALLER",
        text: "Welcome to OpenMeld.",
      })
    ).resolves.toEqual({ id: "1503435956.000247" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        headers: {
          authorization: "Bearer xoxb-test",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      blocks,
      channel: "U_INSTALLER",
      text: "Welcome to OpenMeld.",
    });
  });

  it("falls back to text exactly once when Slack rejects Block Kit", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(SLACK_INVALID_BLOCKS_RESPONSE))
      .mockResolvedValueOnce(
        Response.json(SLACK_CHAT_POST_MESSAGE_SUCCESS_RESPONSE)
      );
    const blocks = [
      {
        text: { text: "Welcome to OpenMeld.", type: "mrkdwn" },
        type: "section",
      },
    ] as const;

    await expect(
      postSlackDirectMessage({
        blocks,
        botToken: "xoxb-test",
        fetchImpl: fetchMock,
        recipientUserId: "U_INSTALLER",
        text: "Welcome to OpenMeld.",
      })
    ).resolves.toEqual({ id: "1503435956.000247" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      blocks,
      channel: "U_INSTALLER",
      text: "Welcome to OpenMeld.",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      channel: "U_INSTALLER",
      text: "Welcome to OpenMeld.",
    });
  });
});

describe("Slack workspace members", () => {
  it("returns one cursor-paginated page of active human members", async () => {
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = new URL(String(request));
      expect(url.pathname).toBe("/api/users.list");
      expect(url.searchParams.get("limit")).toBe("200");
      expect(url.searchParams.get("cursor")).toBe("next-page");
      return Promise.resolve(
        Response.json({
          members: [
            {
              deleted: false,
              id: "U_MEMBER",
              is_admin: true,
              is_app_user: false,
              is_bot: false,
              is_owner: false,
              is_restricted: false,
              is_ultra_restricted: false,
              name: "morgan",
              profile: {
                display_name: "Morgan",
                email: "morgan@example.com",
                real_name: "Morgan Lee",
                title: "Staff Engineer",
              },
              real_name: "Morgan Lee",
            },
            {
              deleted: true,
              id: "U_DEACTIVATED",
              is_bot: false,
              name: "former-member",
              profile: { display_name: "Former Member" },
            },
            {
              deleted: false,
              id: "B_APP",
              is_app_user: true,
              is_bot: true,
              name: "helper-bot",
              profile: { display_name: "Helper Bot" },
            },
          ],
          ok: true,
          response_metadata: { next_cursor: "after-this-page" },
        })
      );
    });

    await expect(
      listSlackWorkspaceMembers({
        botToken: "xoxb-test",
        cursor: "next-page",
        fetchImpl: fetchMock,
        limit: 200,
      })
    ).resolves.toEqual({
      members: [
        {
          displayName: "Morgan",
          email: "morgan@example.com",
          isAdmin: true,
          isGuest: false,
          isOwner: false,
          realName: "Morgan Lee",
          slackUserId: "U_MEMBER",
          title: "Staff Engineer",
        },
      ],
      nextCursor: "after-this-page",
    });
  });
});

describe("Slack channels", () => {
  it("returns one cursor-paginated page with the bot membership state", async () => {
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = new URL(String(request));
      expect(url.pathname).toBe("/api/conversations.list");
      expect(url.searchParams.get("exclude_archived")).toBe("true");
      expect(url.searchParams.get("types")).toBe(
        "public_channel,private_channel"
      );
      expect(url.searchParams.get("limit")).toBe("100");
      expect(url.searchParams.get("cursor")).toBe("next-page");
      return Promise.resolve(
        Response.json({
          channels: [
            {
              id: "C_OK8",
              is_archived: false,
              is_member: true,
              is_private: false,
              name: "ok8-okok",
              num_members: 12,
            },
            {
              id: "C_PRODUCT",
              is_archived: false,
              is_member: false,
              is_private: false,
              name: "product",
              num_members: 42,
            },
          ],
          ok: true,
          response_metadata: { next_cursor: "after-this-page" },
        })
      );
    });

    await expect(
      listSlackChannels({
        botToken: "xoxb-test",
        cursor: "next-page",
        fetchImpl: fetchMock,
        limit: 100,
      })
    ).resolves.toEqual({
      channels: [
        {
          channelId: "C_OK8",
          channelName: "ok8-okok",
          isMember: true,
          isPrivate: false,
          memberCount: 12,
        },
        {
          channelId: "C_PRODUCT",
          channelName: "product",
          isMember: false,
          isPrivate: false,
          memberCount: 42,
        },
      ],
      nextCursor: "after-this-page",
    });
  });
});

describe("Slack channel members", () => {
  it("returns one cursor-paginated page of member IDs", async () => {
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = new URL(String(request));
      expect(url.pathname).toBe("/api/conversations.members");
      expect(url.searchParams.get("channel")).toBe("C_OK8");
      expect(url.searchParams.get("limit")).toBe("200");
      expect(url.searchParams.get("cursor")).toBe("next-page");
      return Promise.resolve(
        Response.json({
          members: ["U_AVA", "U_MORGAN"],
          ok: true,
          response_metadata: { next_cursor: "after-this-page" },
        })
      );
    });

    await expect(
      listSlackChannelMemberIds({
        botToken: "xoxb-test",
        channelId: "C_OK8",
        cursor: "next-page",
        fetchImpl: fetchMock,
        limit: 200,
      })
    ).resolves.toEqual({
      memberIds: ["U_AVA", "U_MORGAN"],
      nextCursor: "after-this-page",
    });
  });
});

describe("Slack channel history", () => {
  it("reads one exact message and returns content-free response diagnostics", async () => {
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = new URL(String(request));
      expect(url.pathname).toBe("/api/conversations.history");
      expect(url.searchParams.get("channel")).toBe("C_OK8");
      expect(url.searchParams.get("oldest")).toBe("1710000004.000400");
      expect(url.searchParams.get("latest")).toBe("1710000004.000400");
      expect(url.searchParams.get("inclusive")).toBe("true");
      expect(url.searchParams.get("limit")).toBe("1");
      return Promise.resolve(
        Response.json({
          messages: [
            {
              blocks: [{ type: "rich_text" }],
              files: [
                {
                  id: "F_FORWARD",
                  mimetype: "image/png",
                  name: "forwarded.png",
                  permalink:
                    "https://openmeld-dev.slack.com/files/U_AVA/F_FORWARD/forwarded",
                  size: 2048,
                  url_private_download:
                    "https://files.slack.com/files-pri/T_OPENMELD-F_FORWARD/download/forwarded.png",
                },
              ],
              text: "Forwarded details",
              ts: "1710000004.000400",
              user: "U_AVA",
            },
          ],
          ok: true,
        })
      );
    });

    await expect(
      readSlackMessageByTimestamp({
        botToken: "xoxb-test",
        channelId: "C_OK8",
        fetchImpl: fetchMock,
        messageTs: "1710000004.000400",
      })
    ).resolves.toEqual({
      message: {
        botId: null,
        displayName: null,
        files: [
          {
            fileId: "F_FORWARD",
            mimeType: "image/png",
            name: "forwarded.png",
            permalink:
              "https://openmeld-dev.slack.com/files/U_AVA/F_FORWARD/forwarded",
            sizeBytes: 2048,
          },
        ],
        subtype: null,
        text: "Forwarded details",
        ts: "1710000004.000400",
        userId: "U_AVA",
      },
      observation: {
        matchingMessageCount: 1,
        messageCount: 1,
        messages: [
          {
            blocksCount: 1,
            fieldNames: ["blocks", "files", "text", "ts", "user"],
            filesCount: 1,
            fileFieldNames: [
              [
                "id",
                "mimetype",
                "name",
                "permalink",
                "size",
                "url_private_download",
              ],
            ],
            textLen: 17,
            tsMatches: true,
          },
        ],
      },
    });
  });

  it("returns one cursor-paginated page of messages without joining the channel", async () => {
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = new URL(String(request));
      expect(url.pathname).toBe("/api/conversations.history");
      expect(url.searchParams.get("channel")).toBe("C_OK8");
      expect(url.searchParams.get("limit")).toBe("15");
      expect(url.searchParams.get("cursor")).toBe("next-page");
      return Promise.resolve(
        Response.json({
          messages: [
            // Slack Web API `conversations.history` file object shape:
            // https://docs.slack.dev/reference/objects/file-object
            {
              files: [
                {
                  id: "F_RELEASE_NOTES",
                  mimetype: "text/markdown",
                  name: "release-notes.md",
                  permalink:
                    "https://openmeld-dev.slack.com/files/U_AVA/F_RELEASE_NOTES/release-notes",
                  size: 1234,
                  url_private_download:
                    "https://files.slack.com/files-pri/T_OPENMELD-F_RELEASE_NOTES/download/release-notes.md",
                },
              ],
              text: null,
              ts: "1710000004.000400",
              user: "U_AVA",
            },
            {
              text: "Latest release update",
              ts: "1710000003.000350",
              user: "U_AVA",
            },
            {
              bot_id: "B_CENTER_AGENT",
              bot_profile: { name: "OpenMeld Center Agent" },
              subtype: "bot_message",
              text: "Earlier summary",
              ts: "1710000002.000300",
            },
          ],
          ok: true,
          response_metadata: { next_cursor: "after-this-page" },
        })
      );
    });

    await expect(
      readSlackChannelHistory({
        botToken: "xoxb-test",
        channelId: "C_OK8",
        cursor: "next-page",
        fetchImpl: fetchMock,
        limit: 15,
      })
    ).resolves.toEqual({
      messages: [
        {
          botId: null,
          displayName: null,
          files: [
            {
              fileId: "F_RELEASE_NOTES",
              mimeType: "text/markdown",
              name: "release-notes.md",
              permalink:
                "https://openmeld-dev.slack.com/files/U_AVA/F_RELEASE_NOTES/release-notes",
              sizeBytes: 1234,
            },
          ],
          subtype: null,
          text: null,
          ts: "1710000004.000400",
          userId: "U_AVA",
        },
        {
          botId: null,
          displayName: null,
          files: [],
          subtype: null,
          text: "Latest release update",
          ts: "1710000003.000350",
          userId: "U_AVA",
        },
        {
          botId: "B_CENTER_AGENT",
          displayName: "OpenMeld Center Agent",
          files: [],
          subtype: "bot_message",
          text: "Earlier summary",
          ts: "1710000002.000300",
          userId: null,
        },
      ],
      nextCursor: "after-this-page",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("Slack file reads", () => {
  it("resolves file metadata and downloads bounded private bytes with the bot token", async () => {
    const fileBytes = new TextEncoder().encode("release notes");
    const fetchMock = vi.fn<typeof fetch>((request, init) => {
      const url = new URL(String(request));
      if (url.pathname === "/api/files.info") {
        expect(url.searchParams.get("file")).toBe("F_RELEASE_NOTES");
        return Promise.resolve(
          Response.json({
            file: {
              id: "F_RELEASE_NOTES",
              mimetype: "text/markdown",
              name: "release-notes.md",
              permalink:
                "https://openmeld-dev.slack.com/files/U_AVA/F_RELEASE_NOTES/release-notes",
              shares: {
                public: {
                  C_OK8: [{ ts: "1710000001.000100" }],
                },
              },
              size: fileBytes.byteLength,
              url_private_download:
                "https://files.slack.com/files-pri/T_OPENMELD-F_RELEASE_NOTES/download/release-notes.md",
            },
            ok: true,
          })
        );
      }
      expect(url.hostname).toBe("files.slack.com");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer xoxb-test"
      );
      return Promise.resolve(new Response(fileBytes));
    });

    await expect(
      readSlackFile({
        botToken: "xoxb-test",
        fetchImpl: fetchMock,
        expectedChannelId: "C_OK8",
        fileId: "F_RELEASE_NOTES",
      })
    ).resolves.toEqual({
      bytes: fileBytes,
      file: {
        fileId: "F_RELEASE_NOTES",
        mimeType: "text/markdown",
        name: "release-notes.md",
        permalink:
          "https://openmeld-dev.slack.com/files/U_AVA/F_RELEASE_NOTES/release-notes",
        sizeBytes: fileBytes.byteLength,
      },
    });
  });

  it("refuses to download a Slack file that is not shared in the expected conversation", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          file: {
            channels: ["C_OTHER"],
            id: "F_PRIVATE",
            size: 10,
            url_private_download:
              "https://files.slack.com/files-pri/T_OPENMELD-F_PRIVATE/download/private.txt",
          },
          ok: true,
        })
      )
    );

    await expect(
      readSlackFile({
        botToken: "xoxb-test",
        expectedChannelId: "C_EXPECTED",
        fetchImpl: fetchMock,
        fileId: "F_PRIVATE",
      })
    ).rejects.toThrow(
      "Slack files.info did not confirm that this file belongs to the requested conversation."
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("Slack file publication", () => {
  it("resolves an exact direct-message conversation for a thread upload", async () => {
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = new URL(String(request));
      expect(url.pathname).toBe("/api/conversations.info");
      expect(url.searchParams.get("channel")).toBe("D0CURRENTTHREAD");
      return Promise.resolve(
        Response.json({
          channel: {
            id: "D0CURRENTTHREAD",
            is_im: true,
            is_member: true,
            is_private: true,
          },
          ok: true,
        })
      );
    });

    await expect(
      resolveSlackConversationMessageTargetById({
        botToken: "xoxb-test",
        conversationId: "D0CURRENTTHREAD",
        fetchImpl: fetchMock,
      })
    ).resolves.toEqual({
      channelId: "D0CURRENTTHREAD",
      channelName: "D0CURRENTTHREAD",
      isMember: true,
      isPrivate: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uploads bytes and completes the file in the exact Slack thread", async () => {
    const fileBytes = new TextEncoder().encode("release notes");
    const fetchMock = vi.fn<typeof fetch>((request, init) => {
      const url = new URL(String(request));
      if (url.pathname === "/api/files.getUploadURLExternal") {
        expect(String(init?.body)).toBe(
          `filename=release-notes.md&length=${fileBytes.byteLength}`
        );
        return Promise.resolve(
          Response.json({
            file_id: "F_UPLOADED",
            ok: true,
            upload_url: "https://files.slack.com/upload/v1/upload-token",
          })
        );
      }
      if (url.pathname === "/upload/v1/upload-token") {
        expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(fileBytes);
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        return Promise.resolve(new Response("OK"));
      }
      if (url.pathname === "/api/files.completeUploadExternal") {
        expect(JSON.parse(String(init?.body))).toEqual({
          channel_id: "C_RELEASE",
          files: [{ id: "F_UPLOADED", title: "Release notes" }],
          initial_comment: "Attached release notes.",
          thread_ts: "1710000000.000100",
        });
        return Promise.resolve(
          Response.json({ files: [{ id: "F_UPLOADED" }], ok: true })
        );
      }
      throw new Error(`Unexpected Slack file request: ${url.pathname}`);
    });

    await expect(
      postSlackFile({
        botToken: "xoxb-test",
        bytes: fileBytes,
        fetchImpl: fetchMock,
        fileName: "release-notes.md",
        initialComment: "Attached release notes.",
        target: {
          channelId: "C_RELEASE",
          channelName: "releases",
          isMember: true,
          isPrivate: false,
        },
        threadTs: "1710000000.000100",
        title: "Release notes",
      })
    ).resolves.toEqual({ fileId: "F_UPLOADED", joinedChannel: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("classifies an interrupted Slack upload completion as outcome unknown", async () => {
    const fileBytes = new TextEncoder().encode("release notes");
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = new URL(String(request));
      if (url.pathname === "/api/files.getUploadURLExternal") {
        return Promise.resolve(
          Response.json({
            file_id: "F_UNKNOWN",
            ok: true,
            upload_url: "https://files.slack.com/upload/v1/unknown",
          })
        );
      }
      if (url.pathname === "/upload/v1/unknown") {
        return Promise.resolve(new Response("OK"));
      }
      if (url.pathname === "/api/files.completeUploadExternal") {
        return Promise.reject(new Error("socket closed"));
      }
      throw new Error(`Unexpected Slack file request: ${url.pathname}`);
    });

    await expect(
      postSlackFile({
        botToken: "xoxb-test",
        bytes: fileBytes,
        fetchImpl: fetchMock,
        fileName: "release-notes.md",
        target: {
          channelId: "C_RELEASE",
          channelName: "releases",
          isMember: true,
          isPrivate: false,
        },
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("outcome is unknown"),
      publicationOutcome: "unknown",
    });
  });
});

describe("Slack thread messages", () => {
  it("reads one bounded ordered page through conversations.replies", async () => {
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = new URL(String(request));
      expect(url.pathname).toBe("/api/conversations.replies");
      expect(url.searchParams.get("channel")).toBe("C_THREAD");
      expect(url.searchParams.get("ts")).toBe("1710000000.000100");
      expect(url.searchParams.get("oldest")).toBe("1710000001.000200");
      expect(url.searchParams.get("latest")).toBe("1710000003.000400");
      expect(url.searchParams.get("inclusive")).toBe("true");
      expect(url.searchParams.get("limit")).toBe("15");
      return Promise.resolve(
        Response.json({
          has_more: true,
          messages: [
            {
              text: "Center Agent summary",
              ts: "1710000002.000300",
              bot_id: "B_CENTER_AGENT",
              bot_profile: { name: "OpenMeld Center Agent" },
              subtype: "bot_message",
              username: "OpenMeld Center Agent",
            },
            {
              text: "Please add the repository links.",
              ts: "1710000003.000350",
              user: "U_ASHLEY",
            },
          ],
          ok: true,
          response_metadata: { next_cursor: "next-page" },
        })
      );
    });

    await expect(
      readSlackThreadMessages({
        botToken: "xoxb-test",
        channelId: "C_THREAD",
        fetchImpl: fetchMock,
        latestTs: "1710000003.000400",
        oldestTs: "1710000001.000200",
        threadTs: "1710000000.000100",
      })
    ).resolves.toEqual({
      hasMore: true,
      messages: [
        {
          botId: "B_CENTER_AGENT",
          displayName: "OpenMeld Center Agent",
          files: [],
          subtype: "bot_message",
          text: "Center Agent summary",
          ts: "1710000002.000300",
          userId: null,
        },
        {
          botId: null,
          displayName: null,
          files: [],
          subtype: null,
          text: "Please add the repository links.",
          ts: "1710000003.000350",
          userId: "U_ASHLEY",
        },
      ],
    });
  });

  it("preserves Slack reply rate-limit evidence", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json(
          { error: "ratelimited", ok: false },
          { headers: { "retry-after": "60" }, status: 429 }
        )
      )
    );

    await expect(
      readSlackThreadMessages({
        botToken: "xoxb-test",
        channelId: "C_THREAD",
        fetchImpl: fetchMock,
        latestTs: "1710000003.000400",
        threadTs: "1710000000.000100",
      })
    ).rejects.toMatchObject({
      errorCode: "ratelimited",
      message: "Slack conversations.replies failed: ratelimited",
      name: "SlackApiError",
      retryAfterSeconds: 60,
      status: 429,
    });
  });

  it("posts controlled blocks with the existing thread and fallback text", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(SLACK_CHAT_POST_MESSAGE_SUCCESS_RESPONSE))
    );

    await expect(
      postSlackThreadMessage({
        blocks: [{ text: "**Done**", type: "markdown" }],
        botToken: "xoxb-test",
        channelId: "C_THREAD",
        fetchImpl: fetchMock,
        text: "*Done*",
        threadTs: "1710000000.001",
      })
    ).resolves.toEqual({ id: "1503435956.000247" });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      blocks: [{ text: "**Done**", type: "markdown" }],
      channel: "C_THREAD",
      text: "*Done*",
      thread_ts: "1710000000.001",
    });
  });

  it("can broadcast a thread reply into the parent conversation", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(SLACK_CHAT_POST_MESSAGE_SUCCESS_RESPONSE))
    );

    await postSlackThreadMessage({
      botToken: "xoxb-test",
      channelId: "D_THREAD",
      fetchImpl: fetchMock,
      replyBroadcast: true,
      text: "Done",
      threadTs: "1710000000.001",
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      channel: "D_THREAD",
      reply_broadcast: true,
      text: "Done",
      thread_ts: "1710000000.001",
    });
  });

  it("posts and reconciles an execution recovery operation through Slack metadata", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        messages: [
          {
            metadata: {
              event_payload: { operation_id: "operation-1" },
              event_type: "openmeld_execution_recovery",
            },
            ts: "1503435956.000247",
          },
        ],
        ok: true,
      })
    );

    await expect(
      findSlackThreadMessageByMetadata({
        botToken: "xoxb-test",
        channelId: "C_THREAD",
        eventPayloadKey: "operation_id",
        eventPayloadValue: "operation-1",
        eventType: "openmeld_execution_recovery",
        fetchImpl: fetchMock,
        threadTs: "1710000000.001",
      })
    ).resolves.toEqual({ id: "1503435956.000247" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "include_all_metadata=true"
    );
  });

  it("includes the stable recovery metadata in chat.postMessage", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(SLACK_CHAT_POST_MESSAGE_SUCCESS_RESPONSE))
    );

    await postSlackThreadMessage({
      botToken: "xoxb-test",
      channelId: "C_THREAD",
      fetchImpl: fetchMock,
      metadata: {
        eventPayload: { operation_id: "operation-1" },
        eventType: "openmeld_execution_recovery",
      },
      text: "Recovered result",
      threadTs: "1710000000.001",
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      channel: "C_THREAD",
      metadata: {
        event_payload: { operation_id: "operation-1" },
        event_type: "openmeld_execution_recovery",
      },
      text: "Recovered result",
      thread_ts: "1710000000.001",
    });
  });

  it("falls back to text exactly once when Slack rejects controlled blocks", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(SLACK_INVALID_BLOCKS_RESPONSE))
      .mockResolvedValueOnce(
        Response.json(SLACK_CHAT_POST_MESSAGE_SUCCESS_RESPONSE)
      );

    await expect(
      postSlackThreadMessage({
        blocks: [{ text: "**Done**", type: "markdown" }],
        botToken: "xoxb-test",
        channelId: "C_THREAD",
        fetchImpl: fetchMock,
        text: "*Done*",
        threadTs: "1710000000.001",
      })
    ).resolves.toEqual({ id: "1503435956.000247" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      channel: "C_THREAD",
      text: "*Done*",
      thread_ts: "1710000000.001",
    });
  });

  it("does not retry confirmed non-presentation failures", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ error: "channel_not_found", ok: false }))
    );

    await expect(
      postSlackThreadMessage({
        blocks: [{ text: "**Done**", type: "markdown" }],
        botToken: "xoxb-test",
        channelId: "C_THREAD",
        fetchImpl: fetchMock,
        text: "*Done*",
        threadTs: "1710000000.001",
      })
    ).rejects.toMatchObject({
      errorCode: "channel_not_found",
      message: "Slack chat.postMessage failed: channel_not_found",
      name: "SlackMessagePublicationError",
      publicationOutcome: "not_published",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves non-success HTTP status context as provider-ambiguous", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 503 }))
    );

    await expect(
      postSlackThreadMessage({
        botToken: "xoxb-test",
        channelId: "C_THREAD",
        fetchImpl: fetchMock,
        text: "Done",
        threadTs: "1710000000.001",
      })
    ).rejects.toMatchObject({
      message: "Slack chat.postMessage outcome is unknown: HTTP 503",
      name: "SlackMessagePublicationError",
      publicationOutcome: "unknown",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps transport failures provider-ambiguous", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error("socket closed"))
    );

    await expect(
      postSlackThreadMessage({
        botToken: "xoxb-test",
        channelId: "C_THREAD",
        fetchImpl: fetchMock,
        text: "Done",
        threadTs: "1710000000.001",
      })
    ).rejects.toMatchObject({
      message: "Slack chat.postMessage outcome is unknown: socket closed",
      name: "SlackMessagePublicationError",
      publicationOutcome: "unknown",
    });
  });

  it("keeps invalid Slack response bodies provider-ambiguous", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("not JSON"))
    );

    await expect(
      postSlackThreadMessage({
        botToken: "xoxb-test",
        channelId: "C_THREAD",
        fetchImpl: fetchMock,
        text: "Done",
        threadTs: "1710000000.001",
      })
    ).rejects.toMatchObject({
      message:
        "Slack chat.postMessage outcome is unknown: Slack API returned invalid JSON",
      name: "SlackMessagePublicationError",
      publicationOutcome: "unknown",
    });
  });
});

describe("Slack message permalinks", () => {
  // Mirrors Slack's documented chat.getPermalink success response:
  // https://docs.slack.dev/reference/methods/chat.getPermalink/
  it("resolves the canonical permalink for the exact message timestamp", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          channel: "C0123456",
          ok: true,
          permalink:
            "https://amplift.slack.com/archives/C0123456/p1720000000000200?thread_ts=1720000000.000100&cid=C0123456",
        })
      )
    );

    await expect(
      getSlackMessagePermalink({
        botToken: "xoxb-test",
        channelId: "C0123456",
        fetchImpl: fetchMock,
        messageTs: "1720000000.000200",
      })
    ).resolves.toBe(
      "https://amplift.slack.com/archives/C0123456/p1720000000000200?thread_ts=1720000000.000100&cid=C0123456"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/chat.getPermalink?channel=C0123456&message_ts=1720000000.000200",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer xoxb-test",
        }),
        method: "GET",
      })
    );
  });

  it("fails closed when Slack returns an unsafe permalink", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          channel: "C0123456",
          ok: true,
          permalink: "https://evil.test/pretend-slack-message",
        })
      )
    );

    await expect(
      getSlackMessagePermalink({
        botToken: "xoxb-test",
        channelId: "C0123456",
        fetchImpl: fetchMock,
        messageTs: "1720000000.000200",
      })
    ).rejects.toThrow("Slack chat.getPermalink returned an invalid permalink");
  });
});

describe("Slack thread status", () => {
  it("sets a working status on the existing Slack thread", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ok: true }))
    );

    await expect(
      setSlackThreadStatus({
        botToken: "xoxb-test",
        channelId: "C_THREAD",
        fetchImpl: fetchMock,
        status: "is working on your request…",
        threadTs: "1710000000.001",
      })
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/assistant.threads.setStatus",
      expect.objectContaining({
        headers: {
          authorization: "Bearer xoxb-test",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      channel_id: "C_THREAD",
      status: "is working on your request…",
      thread_ts: "1710000000.001",
    });
  });

  it("preserves Slack provider error context", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ error: "invalid_thread_ts", ok: false }))
    );

    await expect(
      setSlackThreadStatus({
        botToken: "xoxb-test",
        channelId: "C_THREAD",
        fetchImpl: fetchMock,
        status: "is working on your request…",
        threadTs: "1710000000.001",
      })
    ).rejects.toThrow(
      "Slack assistant.threads.setStatus failed: invalid_thread_ts"
    );
  });

  it("preserves transport error context", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error("socket closed"))
    );

    await expect(
      setSlackThreadStatus({
        botToken: "xoxb-test",
        channelId: "C_THREAD",
        fetchImpl: fetchMock,
        status: "is working on your request…",
        threadTs: "1710000000.001",
      })
    ).rejects.toThrow(
      "Slack assistant.threads.setStatus failed: socket closed"
    );
  });

  it("preserves invalid response context", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("not JSON"))
    );

    await expect(
      setSlackThreadStatus({
        botToken: "xoxb-test",
        channelId: "C_THREAD",
        fetchImpl: fetchMock,
        status: "is working on your request…",
        threadTs: "1710000000.001",
      })
    ).rejects.toThrow(
      "Slack assistant.threads.setStatus failed: Slack API returned invalid JSON"
    );
  });
});

describe("Slack channel messages", () => {
  it("resolves Slack channel mention IDs back to their visible channel name", async () => {
    const fetchMock = createSlackApiFetchMock({
      channels: [
        {
          id: "C0BPRRGHGMS",
          is_archived: false,
          is_member: true,
          is_private: false,
          name: "openmeld-smoke",
        },
      ],
      messageTs: "1710000000.000",
    });

    await expect(
      postSlackChannelMessageByName({
        botToken: "xoxb-test",
        channelName: "#c0bprrghgms",
        fetchImpl: fetchMock,
        text: "Hello from the Center Agent.",
      })
    ).resolves.toEqual({
      channelId: "C0BPRRGHGMS",
      channelName: "openmeld-smoke",
      joinedChannel: false,
      messageTs: "1710000000.000",
    });
  });

  it("joins an accessible public channel and posts to its main conversation", async () => {
    const fetchMock = createSlackApiFetchMock({
      channels: [
        {
          id: "C_RELEASE",
          is_archived: false,
          is_member: false,
          is_private: false,
          name: "release",
        },
      ],
      messageTs: "1710000000.001",
    });

    await expect(
      postSlackChannelMessageByName({
        botToken: "xoxb-test",
        channelName: "#Release",
        fetchImpl: fetchMock,
        text: "The release is ready.",
      })
    ).resolves.toEqual({
      channelId: "C_RELEASE",
      channelName: "release",
      joinedChannel: true,
      messageTs: "1710000000.001",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/conversations.list?"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://slack.com/api/conversations.join"
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      channel: "C_RELEASE",
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://slack.com/api/chat.postMessage"
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      channel: "C_RELEASE",
      text: "The release is ready.",
    });
  });

  it("posts to an exact existing Slack thread", async () => {
    const fetchMock = createSlackApiFetchMock({
      channels: [
        {
          id: "C_OK8",
          is_archived: false,
          is_member: true,
          is_private: false,
          name: "ok8-okok",
        },
      ],
      messageTs: "1787091616.564859",
    });

    await expect(
      postSlackChannelMessageByName({
        botToken: "xoxb-test",
        channelName: "ok8-okok",
        fetchImpl: fetchMock,
        text: "Here is the proposed next step.",
        threadTs: "1786979718.343639",
      })
    ).resolves.toMatchObject({
      channelId: "C_OK8",
      joinedChannel: false,
      messageTs: "1787091616.564859",
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      channel: "C_OK8",
      text: "Here is the proposed next step.",
      thread_ts: "1786979718.343639",
    });
  });

  it("classifies a channel join failure as definitely not published", async () => {
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const pathname = new URL(String(request)).pathname;
      if (pathname === "/api/conversations.list") {
        return Promise.resolve(
          Response.json({
            channels: [
              {
                id: "C_RELEASE",
                is_archived: false,
                is_member: false,
                is_private: false,
                name: "release",
              },
            ],
            ok: true,
            response_metadata: { next_cursor: "" },
          })
        );
      }
      if (pathname === "/api/conversations.join") {
        return Promise.resolve(
          Response.json({ error: "channel_not_found", ok: false })
        );
      }
      throw new Error(`Unexpected Slack API request: ${pathname}`);
    });

    await expect(
      postSlackChannelMessageByName({
        botToken: "xoxb-test",
        channelName: "release",
        fetchImpl: fetchMock,
        text: "The release is ready.",
      })
    ).rejects.toMatchObject({
      errorCode: "channel_not_found",
      publicationOutcome: "not_published",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("posts to an accessible private channel without trying to join it", async () => {
    const fetchMock = createSlackApiFetchMock({
      channels: [
        {
          id: "G_LEADERSHIP",
          is_archived: false,
          is_member: true,
          is_private: true,
          name: "leadership",
        },
      ],
      messageTs: "1710000000.002",
    });

    await expect(
      postSlackChannelMessageByName({
        botToken: "xoxb-test",
        channelName: "leadership",
        fetchImpl: fetchMock,
        text: "The private update is ready.",
      })
    ).resolves.toEqual({
      channelId: "G_LEADERSHIP",
      channelName: "leadership",
      joinedChannel: false,
      messageTs: "1710000000.002",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://slack.com/api/chat.postMessage"
    );
  });

  it("normalizes code-wrapped presentation tokens before posting channel text", async () => {
    const fetchMock = createSlackApiFetchMock({
      channels: [
        {
          id: "C_RELEASE",
          is_archived: false,
          is_member: true,
          is_private: false,
          name: "release",
        },
      ],
      messageTs: "1710000000.003",
    });

    await expect(
      postSlackChannelMessageByName({
        botToken: "xoxb-test",
        channelName: "release",
        fetchImpl: fetchMock,
        text: [
          "`<https://github.com/amplifthq/reply/pull/154|#154 fix P0>`",
          "See `[Open Space](https://openmeld.ai/o/amplift/spaces/space_123)` and notify `<@U123456>`.",
        ].join("\n"),
      })
    ).resolves.toMatchObject({
      channelId: "C_RELEASE",
      joinedChannel: false,
      messageTs: "1710000000.003",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      channel: "C_RELEASE",
      text: [
        "<https://github.com/amplifthq/reply/pull/154|#154 fix P0>",
        "See <https://openmeld.ai/o/amplift/spaces/space_123|Open Space> and notify <@U123456>.",
      ].join("\n"),
    });
  });

  it("explains that private channels must invite the app when no channel is accessible", async () => {
    const fetchMock = createSlackApiFetchMock({ channels: [] });

    await expect(
      postSlackChannelMessageByName({
        botToken: "xoxb-test",
        channelName: "secret-launch",
        fetchImpl: fetchMock,
        text: "Launch update.",
      })
    ).rejects.toThrow(
      "I couldn't find #secret-launch in the connected Slack workspace. If it is private, invite the OpenMeld app to that channel first."
    );
  });

  it("refuses a visible private channel that has not invited the app", async () => {
    const fetchMock = createSlackApiFetchMock({
      channels: [
        {
          id: "G_SECRET",
          is_archived: false,
          is_member: false,
          is_private: true,
          name: "secret-launch",
        },
      ],
    });

    await expect(
      postSlackChannelMessageByName({
        botToken: "xoxb-test",
        channelName: "secret-launch",
        fetchImpl: fetchMock,
        text: "Launch update.",
      })
    ).rejects.toThrow(
      "I can't join #secret-launch because it is private. Invite the OpenMeld app to that channel first."
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function createSlackApiFetchMock(input: {
  channels: Array<{
    id: string;
    is_archived: boolean;
    is_member: boolean;
    is_private: boolean;
    name: string;
  }>;
  messageTs?: string;
}) {
  return vi.fn<typeof fetch>((request) => {
    const pathname = new URL(String(request)).pathname;
    if (pathname === "/api/conversations.list") {
      return Promise.resolve(
        Response.json({
          channels: input.channels,
          ok: true,
          response_metadata: { next_cursor: "" },
        })
      );
    }
    if (pathname === "/api/conversations.join") {
      return Promise.resolve(Response.json({ ok: true }));
    }
    if (pathname === "/api/chat.postMessage" && input.messageTs) {
      return Promise.resolve(Response.json({ ok: true, ts: input.messageTs }));
    }
    throw new Error(`Unexpected Slack API request: ${pathname}`);
  });
}
