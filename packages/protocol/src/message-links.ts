import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export type MessageLink = {
  start: number;
  end: number;
  url: string;
  label: string;
};

/** Shared by plain-text presentation, Markdown anchors, and server previews. */
export function normalizeMessageLink(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:", "mailto:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

type LinkNode = {
  type: string;
  url?: string;
  value?: string;
  children?: LinkNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

function nodeText(node: LinkNode): string {
  return node.value ?? node.children?.map(nodeText).join("") ?? "";
}

export function collectMessageLinks(text: string): MessageLink[] {
  const tree = fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const links: MessageLink[] = [];
  function visit(node: LinkNode) {
    if (
      ["code", "inlineCode", "html", "image", "imageReference"].includes(
        node.type
      )
    ) {
      return;
    }
    if (node.type === "link") {
      const url = normalizeMessageLink(node.url ?? "");
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (url && start !== undefined && end !== undefined) {
        links.push({ start, end, url, label: nodeText(node) || url });
      }
      return;
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  }
  visit(tree);
  return links;
}

export function collectMessagePreviewUrls(text: string): string[] {
  return [
    ...new Set(
      collectMessageLinks(text)
        .map((link) => link.url)
        .filter(
          (url) => url.startsWith("https://") || url.startsWith("http://")
        )
    ),
  ];
}
