import { cjk } from "@streamdown/cjk";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import rehypeSanitize from "rehype-sanitize";
import { defaultRemarkPlugins, Streamdown } from "streamdown";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CachedMarkdownBlock,
	clearMarkdownBlockCache,
	MarkdownBlockCacheScope,
	readMarkdownBlockCacheSize,
	readMarkdownSplitCacheSize,
} from "./markdown-block-cache";
import { MessageResponse } from "./message-response";

const MARKDOWN_CORPUS = [
	"Plain paragraph with **bold**, *emphasis*, `code`, and ~~strike~~.",
	"## Heading\n\n- one\n- two\n  - nested\n\n1. first\n2. second",
	"```ts\nconst value = 1;\n```\n\nAfter the fence.",
	"| A | B |\n| --- | --- |\n| 1 | 2 |",
	"> Quote with a [link](https://example.com/path?q=1) and https://autolink.example.com",
	"中文段落，**加粗**文本。日本語のテキスト。",
	"<script>alert(1)</script>\n\nAfter script.",
	'<img src="x" onerror="alert(1)">',
	"[bad](javascript:alert(1)) and [data](data:text/html,<b>x</b>)",
	'<a href="javascript:alert(1)">raw anchor</a>',
	"![image](https://example.com/image.png)",
	"Footnote[^1].\n\n[^1]: The note.",
];

let parseCount = 0;
function countingRemarkPlugin() {
	return () => {
		parseCount += 1;
	};
}
const COUNTING_PLUGINS = [countingRemarkPlugin];

describe("markdown block cache", () => {
	beforeEach(() => {
		clearMarkdownBlockCache();
		parseCount = 0;
	});
	afterEach(() => {
		cleanup();
	});

	it("renders cached blocks exactly like Streamdown's own Block", () => {
		const props = {
			animated: false,
			disallowedElements: ["img"],
			linkSafety: { enabled: false },
			mode: "streaming",
			parseIncompleteMarkdown: true,
			plugins: { cjk },
			rehypePlugins: [rehypeSanitize],
			remarkPlugins: Object.values(defaultRemarkPlugins),
			skipHtml: true,
			urlTransform: (url: string) => (url.startsWith("https://") ? url : ""),
		} satisfies Partial<ComponentProps<typeof Streamdown>>;
		for (const markdown of MARKDOWN_CORPUS) {
			const reference = render(<Streamdown {...props}>{markdown}</Streamdown>);
			const expected = reference.container.innerHTML;
			reference.unmount();
			for (const pass of ["miss", "hit"]) {
				const cached = render(
					<MarkdownBlockCacheScope enabled={true}>
						<Streamdown {...props} BlockComponent={CachedMarkdownBlock}>
							{markdown}
						</Streamdown>
					</MarkdownBlockCacheScope>
				);
				expect(
					cached.container.innerHTML,
					`${pass}: ${JSON.stringify(markdown)}`
				).toBe(expected);
				cached.unmount();
			}
		}
	});

	it("reuses parsed blocks when a finalized message remounts", () => {
		const markdown = "First paragraph.\n\nSecond paragraph.";
		const first = render(
			<MessageResponse
				additionalRemarkPlugins={COUNTING_PLUGINS}
				variant="space-message"
			>
				{markdown}
			</MessageResponse>
		);
		const firstMarkup = first.container.innerHTML;
		const parsesOnMount = parseCount;
		expect(parsesOnMount).toBeGreaterThan(0);
		first.unmount();

		const second = render(
			<MessageResponse
				additionalRemarkPlugins={COUNTING_PLUGINS}
				variant="space-message"
			>
				{markdown}
			</MessageResponse>
		);

		expect(parseCount).toBe(parsesOnMount);
		expect(second.container.innerHTML).toBe(firstMarkup);
	});

	it("does not cache or serve stale text while a message streams", () => {
		const view = render(
			<MessageResponse isStreaming={true} variant="space-message">
				Partial answer
			</MessageResponse>
		);
		view.rerender(
			<MessageResponse isStreaming={true} variant="space-message">
				Partial answer that keeps growing
			</MessageResponse>
		);
		expect(readMarkdownBlockCacheSize()).toBe(0);
		expect(screen.getByText("Partial answer that keeps growing")).toBeTruthy();

		view.rerender(
			<MessageResponse isStreaming={false} variant="space-message">
				Final answer
			</MessageResponse>
		);
		expect(screen.getByText("Final answer")).toBeTruthy();
		expect(screen.queryByText("Partial answer that keeps growing")).toBeNull();
		expect(readMarkdownBlockCacheSize()).toBeGreaterThan(0);

		view.rerender(
			<MessageResponse isStreaming={false} variant="space-message">
				Edited answer
			</MessageResponse>
		);
		expect(screen.getByText("Edited answer")).toBeTruthy();
		expect(screen.queryByText("Final answer")).toBeNull();
	});

	it("keeps sanitizing every cached render of untrusted Markdown", () => {
		const markdown = [
			"<script>window.__xss = 1</script>",
			'<img src="x" onerror="window.__xss = 1">',
			"[click](javascript:window.__xss=1)",
			'<a href="javascript:window.__xss=1">raw</a>',
			'<iframe src="https://example.com"></iframe>',
		].join("\n\n");
		for (const pass of ["miss", "hit"]) {
			const view = render(
				<MessageResponse variant="space-message">{markdown}</MessageResponse>
			);
			const html = view.container.innerHTML;
			expect(html, pass).not.toContain("<script");
			expect(html, pass).not.toContain("<img");
			expect(html, pass).not.toContain("<iframe");
			expect(html, pass).not.toContain("onerror");
			expect(html, pass).not.toContain('href="javascript:');
			expect(view.container.querySelector("a[href]")).toBeNull();
			view.unmount();
		}
		expect(readMarkdownBlockCacheSize()).toBeGreaterThan(0);
	});

	it("renders internal links with the current message's renderer after a cache hit", () => {
		const markdown = `[Space](/spaces/${"a".repeat(64)})`;
		const first = render(
			<MessageResponse
				renderInternalLink={() => <span>First renderer</span>}
				variant="space-message"
			>
				{markdown}
			</MessageResponse>
		);
		expect(screen.getByText("First renderer")).toBeTruthy();
		first.unmount();

		render(
			<MessageResponse
				renderInternalLink={() => <span>Second renderer</span>}
				variant="space-message"
			>
				{markdown}
			</MessageResponse>
		);

		expect(screen.getByText("Second renderer")).toBeTruthy();
		expect(screen.queryByText("First renderer")).toBeNull();
	});

	it("keys blocks by plugin options so different mentions never share output", () => {
		const optionsPlugin = (options: { label: string }) => (tree: unknown) => {
			const root = tree as {
				children: { children?: { type: string; value?: string }[] }[];
			};
			const text = root.children[0]?.children?.[0];
			if (text?.type === "text") {
				text.value = options.label;
			}
		};
		const first = render(
			<MessageResponse
				additionalRemarkPlugins={[[optionsPlugin, { label: "Ada" }]]}
				variant="space-message"
			>
				placeholder
			</MessageResponse>
		);
		expect(screen.getByText("Ada")).toBeTruthy();
		first.unmount();

		render(
			<MessageResponse
				additionalRemarkPlugins={[[optionsPlugin, { label: "Grace" }]]}
				variant="space-message"
			>
				placeholder
			</MessageResponse>
		);

		expect(screen.getByText("Grace")).toBeTruthy();
	});

	it("does not retain a message larger than the cache budget", () => {
		const paragraph = "word ".repeat(2000);
		const huge = Array.from({ length: 70 }, () => paragraph).join("\n\n");
		const view = render(
			<MessageResponse variant="space-message">{huge}</MessageResponse>
		);
		view.unmount();
		render(
			<MessageResponse variant="space-message">Small note</MessageResponse>
		);

		expect(readMarkdownSplitCacheSize()).toBe(1);
	});
});
