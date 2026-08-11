import { cn } from "@openmeld/ui/lib/utils";
import { cjk } from "@streamdown/cjk";
import { type ComponentProps, memo, type ReactNode, useMemo } from "react";
import rehypeSanitize from "rehype-sanitize";
import type { ExtraProps } from "streamdown";
import { defaultRemarkPlugins, Streamdown } from "streamdown";

const ALLOWED_MARKDOWN_PROTOCOLS = new Set(["https:", "mailto:"]);
const ALLOWED_INTERNAL_SPACE_PATH_PATTERN = /^\/spaces\/[0-9a-f]{64}$/;
const MESSAGE_RESPONSE_STYLE = { overflowWrap: "anywhere" } as const;
const STREAMDOWN_ANIMATION = { animation: "blurIn" } as const;
const STREAMDOWN_DISALLOWED_ELEMENTS = ["img"];
const STREAMDOWN_LINK_SAFETY = { enabled: false };
const STREAMDOWN_PLUGINS = { cjk };
const STREAMDOWN_REHYPE_PLUGINS = [rehypeSanitize];

type InternalMarkdownLinkRenderer = (input: {
	children: ReactNode;
	href: string;
}) => ReactNode;

type MarkdownAstNode = {
	children?: MarkdownAstNode[];
	type: string;
};

type MessageResponseProps = Omit<
	ComponentProps<typeof Streamdown>,
	| "animated"
	| "children"
	| "components"
	| "disallowedElements"
	| "isAnimating"
	| "linkSafety"
	| "mode"
	| "parseIncompleteMarkdown"
	| "plugins"
	| "rehypePlugins"
	| "remarkPlugins"
	| "skipHtml"
	| "urlTransform"
> & {
	additionalRemarkPlugins?: NonNullable<
		ComponentProps<typeof Streamdown>["remarkPlugins"]
	>;
	children: string;
	className?: string;
	isStreaming?: boolean;
	renderInternalLink?: InternalMarkdownLinkRenderer;
};

// Local AI Elements-compatible MessageResponse wrapper.
// Source direction: AI Elements MessageResponse@2026-07 with Streamdown@2.5.0.
// OpenMeld owns the safety policy because Space content is untrusted.
export const MessageResponse = memo(function MessageResponse({
	additionalRemarkPlugins,
	children,
	className,
	isStreaming = false,
	renderInternalLink,
	...props
}: MessageResponseProps) {
	const components = useMemo<
		NonNullable<ComponentProps<typeof Streamdown>["components"]>
	>(
		() => ({
			a: (linkProps) => (
				<SafeMarkdownLink
					{...linkProps}
					renderInternalLink={renderInternalLink}
				/>
			),
			img: DisabledMarkdownImage,
			strong: MarkdownStrong,
			table: MarkdownTable,
		}),
		[renderInternalLink]
	);
	const remarkPlugins = useMemo(
		() =>
			additionalRemarkPlugins
				? [...BASE_REMARK_PLUGINS, ...additionalRemarkPlugins]
				: BASE_REMARK_PLUGINS,
		[additionalRemarkPlugins]
	);

	return (
		<div
			className={cn(
				className,
				"typeset typeset-chat break-words text-sm leading-[var(--typeset-leading)] [overflow-wrap:anywhere]"
			)}
			style={MESSAGE_RESPONSE_STYLE}
		>
			<Streamdown
				animated={STREAMDOWN_ANIMATION}
				components={components}
				disallowedElements={STREAMDOWN_DISALLOWED_ELEMENTS}
				isAnimating={isStreaming}
				linkSafety={STREAMDOWN_LINK_SAFETY}
				mode="streaming"
				parseIncompleteMarkdown={true}
				plugins={STREAMDOWN_PLUGINS}
				rehypePlugins={STREAMDOWN_REHYPE_PLUGINS}
				remarkPlugins={remarkPlugins}
				skipHtml={true}
				urlTransform={transformSafeMarkdownUrl}
				{...props}
			>
				{children}
			</Streamdown>
		</div>
	);
});

function SafeMarkdownLink(
	props: ComponentProps<"a"> & {
		renderInternalLink?: InternalMarkdownLinkRenderer;
	} & ExtraProps
) {
	const { children, href, node: _node, renderInternalLink, ...rest } = props;
	if (href && isAllowedInternalSpacePath(href)) {
		return renderInternalLink?.({ children, href }) ?? <>{children}</>;
	}
	if (!(href && isAllowedMarkdownUrl(href))) {
		return <>{children}</>;
	}

	return (
		<a href={href} rel="noopener noreferrer" target="_blank" {...rest}>
			{children}
		</a>
	);
}

function DisabledMarkdownImage() {
	return null;
}

function MarkdownStrong({
	children,
	node: _node,
	...props
}: ComponentProps<"strong"> & ExtraProps) {
	return <strong {...props}>{children}</strong>;
}

function MarkdownTable({
	children,
	node: _node,
	...props
}: ComponentProps<"table"> & ExtraProps) {
	return (
		<div className="typeset-scroll w-fit max-w-full rounded-md">
			<table {...props}>{children}</table>
		</div>
	);
}

function removeRawHtmlRemarkPlugin() {
	return (tree: MarkdownAstNode) => {
		removeRawHtmlNodes(tree);
	};
}

const BASE_REMARK_PLUGINS = [
	removeRawHtmlRemarkPlugin,
	...Object.values(defaultRemarkPlugins),
];

function removeRawHtmlNodes(node: MarkdownAstNode) {
	if (!node.children) {
		return;
	}

	node.children = node.children.filter((child) => child.type !== "html");
	for (const child of node.children) {
		removeRawHtmlNodes(child);
	}
}

function transformSafeMarkdownUrl(url: string) {
	return isAllowedMarkdownUrl(url) || isAllowedInternalSpacePath(url)
		? url
		: "";
}

function isAllowedInternalSpacePath(url: string): boolean {
	return ALLOWED_INTERNAL_SPACE_PATH_PATTERN.test(url);
}

function isAllowedMarkdownUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return ALLOWED_MARKDOWN_PROTOCOLS.has(parsed.protocol);
	} catch {
		return false;
	}
}
