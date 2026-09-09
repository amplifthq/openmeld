import { describe, expect, it, vi } from "vitest";
import { publishLarkPlatformFile } from "../src/remote-agent/application/lark-platform-file-publication";

const base = {
  appId: "cli_test",
  appSecret: "test-secret",
  bytes: new TextEncoder().encode("report"),
  fileName: "report.txt",
  messageId: "om_root",
  replyInThread: true,
  providerPublicationIdempotencyKey: "11111111-1111-5111-8111-111111111111",
};
// Vendor response shape: /document/server-docs/im-v1/file/create.md.
const upload = () =>
  Response.json({
    code: 0,
    msg: "success",
    data: { file_key: "file_456a92d6-c6ea-4de4-ac3f-7afcf44ac78g" },
  });
const token = () =>
  Response.json({ code: 0, expire: 7200, tenant_access_token: "tenant-token" });

describe("native channel file publication", () => {
  it.each([
    "feishu",
    "lark",
  ] as const)("uploads bytes and replies in the frozen %s topic", async (provider) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(upload())
      .mockResolvedValueOnce(
        Response.json({ code: 0, data: { message_id: "om_reply" } })
      );
    expect(
      await publishLarkPlatformFile({ ...base, provider, fetchImpl })
    ).toEqual({ status: "published", resultId: "om_reply" });
    const origin =
      provider === "feishu"
        ? "https://open.feishu.cn"
        : "https://open.larksuite.com";
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      `${origin}/open-apis/im/v1/files`
    );
    const form = fetchImpl.mock.calls[1]?.[1]?.body as FormData;
    expect(form.get("file_name")).toBe("report.txt");
    expect(form.get("file_type")).toBe("stream");
    expect(await (form.get("file") as Blob).text()).toBe("report");
    expect(fetchImpl.mock.calls[2]?.[0]).toBe(
      `${origin}/open-apis/im/v1/messages/om_root/reply`
    );
    expect(JSON.parse(fetchImpl.mock.calls[2]?.[1]?.body as string)).toEqual({
      msg_type: "file",
      content: JSON.stringify({
        file_key: "file_456a92d6-c6ea-4de4-ac3f-7afcf44ac78g",
      }),
      reply_in_thread: true,
      uuid: base.providerPublicationIdempotencyKey,
    });
  });
  it.each([
    "lost",
    "server",
    "malformed",
  ])("preserves an unknown visible outcome after %s response", async (mode) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(upload());
    if (mode === "lost") {
      fetchImpl.mockRejectedValueOnce(new Error("connection lost"));
    } else {
      fetchImpl.mockResolvedValueOnce(
        mode === "server"
          ? new Response("error", { status: 503 })
          : Response.json({ code: 0 })
      );
    }
    expect(
      await publishLarkPlatformFile({ ...base, provider: "feishu", fetchImpl })
    ).toMatchObject({ status: "outcome_unknown" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("never sends a message after a rejected private upload", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(
        Response.json({ code: 234_002, msg: "Unauthorized" }, { status: 401 })
      );
    expect(
      await publishLarkPlatformFile({ ...base, provider: "lark", fetchImpl })
    ).toMatchObject({ status: "failed" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("rejects empty files before any provider call", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(
      await publishLarkPlatformFile({
        ...base,
        bytes: new Uint8Array(),
        provider: "lark",
        fetchImpl,
      })
    ).toMatchObject({ status: "failed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
