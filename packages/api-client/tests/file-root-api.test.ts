import { describe, expect, it, vi } from "vitest";
import type { OpenMeldApiClientFoundation } from "../src/client";
import { createFileRootApi } from "../src/file-root/api";

function api(response: Response) {
  const requestResponse = vi.fn(async () => response);
  const client = createFileRootApi({
    requestResponse,
    requestJson: vi.fn(),
    requestText: vi.fn(),
  } as unknown as OpenMeldApiClientFoundation);
  return { client, requestResponse };
}

describe("file-root content", () => {
  it("streams the selected exact revision without buffering it", async () => {
    const response = new Response("hello", {
      headers: {
        "content-length": "5",
        "content-type": "text/plain",
        "x-openmeld-file-revision": "2",
      },
    });
    const { client, requestResponse } = api(response);
    const result = await client.streamContent({
      location: "team",
      fileId: "file-1",
      revision: 2,
    });
    expect(result.revision).toBe(2);
    expect(result.sizeBytes).toBe(5);
    expect(await new Response(result.bytes).text()).toBe("hello");
    expect(requestResponse).toHaveBeenCalledWith({
      operation: "files.content.download",
      url: "/v1/organizations/current/files/team/file-1/content?revision=2",
    });
  });

  it("rejects a content response without a declared length", async () => {
    const { client } = api(
      new Response("hello", {
        headers: { "x-openmeld-file-revision": "1" },
      })
    );
    await expect(
      client.streamContent({ location: "my", fileId: "file-1" })
    ).rejects.toThrow("Invalid file content response");
  });

  it("keeps the buffered download callable independently", async () => {
    const { client } = api(
      new Response("hello", {
        headers: {
          "content-length": "5",
          "content-type": "text/plain",
          "x-openmeld-file-revision": "1",
        },
      })
    );
    const { download } = client;
    const result = await download({ location: "my", fileId: "file-1" });
    expect(new TextDecoder().decode(result.bytes)).toBe("hello");
  });
});
