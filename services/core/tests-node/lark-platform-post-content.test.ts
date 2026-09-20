import { describe, expect, it } from "vitest";
import { readLarkPlatformPostContent } from "../src/remote-agent/application/lark-platform-post-content";

// Received post node shapes from the official message_content example, not the
// locale-wrapped outgoing create_json shape.
// https://open.feishu.cn/document/server-docs/im-v1/message-content-description/message_content
describe("received Lark-platform rich messages", () => {
  it("preserves title, links, mention keys, paragraphs, code and image provenance", () => {
    const result = readLarkPlatformPostContent({
      title: "Review",
      content: [
        [
          { tag: "at", user_id: "@_user_1", user_name: "" },
          { tag: "text", text: " check " },
          { tag: "a", text: "source", href: "https://open.feishu.cn" },
        ],
        [{ tag: "img", image_key: "img_47354fbc-a159-40ed-86ab-2ad0f1acb42g" }],
        [
          {
            tag: "code_block",
            language: "GO",
            text: "func main() {\n    return\n}",
          },
        ],
      ],
    });
    expect(result?.text).toBe(
      "Review\n@_user_1 check source (https://open.feishu.cn)\n[Attached image]\n\nfunc main() {\n    return\n}"
    );
    expect(result?.resources).toEqual([
      {
        type: "image",
        fileKey: "img_47354fbc-a159-40ed-86ab-2ad0f1acb42g",
        fileName: null,
        mimeType: null,
        sizeBytes: null,
      },
    ]);
  });

  it("prefers original Markdown while retaining legacy image descriptors once", () => {
    const result = readLarkPlatformPostContent({
      content: [
        [
          { tag: "text", text: "flattened" },
          { tag: "img", image_key: "img_same" },
        ],
      ],
      content_v2: [
        [
          { tag: "md", text: "- [x] **Reviewed**\n![image](img_same)" },
          { tag: "img", image_key: "img_same" },
        ],
      ],
    });
    expect(result?.text).toContain("- [x] **Reviewed**");
    expect(result?.text).not.toContain("flattened");
    expect(result?.resources).toHaveLength(1);
  });

  it("retains unsupported media as a resource so admission reports the limitation", () => {
    expect(
      readLarkPlatformPostContent({
        content: [[{ tag: "media", file_key: "file_video" }]],
      })?.resources[0]?.type
    ).toBe("video");
    expect(
      readLarkPlatformPostContent({ content: [[{ tag: "unknown" }]] })?.text
    ).toContain("Unsupported");
    expect(
      readLarkPlatformPostContent({ title: "bad", content: "invalid" })
    ).toBeNull();
  });
});
