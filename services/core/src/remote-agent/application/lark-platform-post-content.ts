import type { MessageChannelResourceDescriptor } from "@openmeld/schemas/types";

/** Received post shape, not the locale-wrapped shape used when sending a post.
 * https://open.feishu.cn/document/server-docs/im-v1/message-content-description/message_content
 */
export function readLarkPlatformPostContent(
  content: Record<string, unknown> | null
): {
  resources: MessageChannelResourceDescriptor[];
  text: string;
} | null {
  if (!(content && Array.isArray(content.content))) {
    return null;
  }
  const resources: MessageChannelResourceDescriptor[] = [];
  const lines: string[] = [];
  if (typeof content.title === "string") {
    lines.push(content.title);
  }
  // Read legacy nodes for resource provenance even when content_v2 preserves Markdown.
  const render = (rows: unknown[]): string[] =>
    rows.map((row) => {
      if (!Array.isArray(row)) {
        return "[Unsupported rich-message content]";
      }
      return row
        .map((node: unknown) => renderPostNode(node, resources))
        .join("");
    });
  const legacyLines = render(content.content);
  lines.push(
    ...(Array.isArray(content.content_v2)
      ? render(content.content_v2)
      : legacyLines)
  );
  const text = lines.join("\n").trim();
  return text ? { resources, text } : null;
}

function renderPostNode(
  node: unknown,
  resources: MessageChannelResourceDescriptor[]
): string {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return "[Unsupported rich-message content]";
  }
  const element = node as Record<string, unknown>;
  const text = typeof element.text === "string" ? element.text : "";
  switch (element.tag) {
    case "text":
    case "md":
      return text;
    case "a":
      return typeof element.href === "string"
        ? `${text} (${element.href})`
        : text;
    case "at":
      return typeof element.user_id === "string"
        ? element.user_id
        : "[Mention]";
    case "code_block":
      return `\n${text}\n`;
    case "hr":
      return "\n---\n";
    case "emotion":
      return typeof element.emoji_type === "string"
        ? `:${element.emoji_type}:`
        : "";
    case "img":
    case "media":
      return renderPostResource(element, resources);
    default:
      return "[Unsupported rich-message content]";
  }
}

function renderPostResource(
  element: Record<string, unknown>,
  resources: MessageChannelResourceDescriptor[]
): string {
  const type = element.tag === "img" ? "image" : "video";
  const fileKey = element[type === "image" ? "image_key" : "file_key"];
  if (typeof fileKey !== "string" || !fileKey.trim()) {
    return "[Unavailable attachment]";
  }
  if (
    !resources.some(
      (resource) => resource.fileKey === fileKey && resource.type === type
    )
  ) {
    resources.push({
      fileKey,
      fileName: null,
      mimeType: null,
      sizeBytes: null,
      type,
    });
  }
  return `[Attached ${type}]`;
}
