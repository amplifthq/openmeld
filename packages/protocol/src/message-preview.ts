import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

type PreviewNode = {
  type: string;
  value?: string;
  alt?: string | null;
  children?: PreviewNode[];
};

/** Render readable labels, never Markdown syntax, HTML or action payloads. */
export function normalizeMessagePreview(text: string): string {
  const tree = fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  function read(node: PreviewNode): string {
    if (["html", "code", "definition"].includes(node.type)) {
      return "";
    }
    if (node.type === "image" || node.type === "imageReference") {
      return node.alt ?? "";
    }
    if (node.type === "break") {
      return " ";
    }
    if (node.value !== undefined) {
      return node.value;
    }
    const separator = [
      "root",
      "list",
      "blockquote",
      "table",
      "tableRow",
      "listItem",
    ].includes(node.type)
      ? " "
      : "";
    return (node.children ?? []).map(read).join(separator);
  }
  return read(tree).replace(/\s+/g, " ").trim();
}
