import { normalizeMessageLink } from "@openmeld/protocol";
import { cn } from "@openmeld/ui/lib/utils";
import { cjk } from "@streamdown/cjk";
import { type ComponentProps, memo, type ReactNode, useMemo } from "react";
import rehypeSanitize from "rehype-sanitize";
import type { ExtraProps } from "streamdown";
import { defaultRemarkPlugins, Streamdown } from "streamdown";

const ALLOWED_INTERNAL_SPACE_PATH_PATTERN = /^\/spaces\/[0-9a-f]{64}$/;
const ALLOWED_INTERNAL_PROFILE_MENTION_PATH_PATTERN =
	/^\/__openmeld\/message-profile-mentions\/[^/?#]+(?:\?relation=(?:wake|reference|mention))?$/;
const MESSAGE_RESPONSE_STYLE = { overflowWrap: "anywhere" } as const;
const STREAMDOWN_ANIMATION = { animation: "blurIn" } as const;
const STREAMDOWN_DISALLOWED_ELEMENTS = ["img"];
const STREAMDOWN_LINK_SAFETY = { enabled: false };
const STREAMDOWN_PLUGINS = { cjk };
const STREAMDOWN_REHYPE_PLUGINS = [rehypeSanitize];
const TYPESET_VARIANT_CLASS_NAMES = {
	changelog: "typeset-changelog",
	"space-message": "typeset-space-message",
} as const;

export type MessageResponseVariant = keyof typeof TYPESET_VARIANT_CLASS_NAMES;

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
	variant: MessageResponseVariant;
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
	variant,
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
				"typeset break-words [overflow-wrap:anywhere]",
				TYPESET_VARIANT_CLASS_NAMES[variant]
			)}
			data-typeset-variant={variant}
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
	if (href && isAllowedInternalMessagePath(href)) {
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
	return isAllowedMarkdownUrl(url) || isAllowedInternalMessagePath(url)
		? url
		: "";
}

function isAllowedInternalMessagePath(url: string): boolean {
	return (
		ALLOWED_INTERNAL_SPACE_PATH_PATTERN.test(url) ||
		ALLOWED_INTERNAL_PROFILE_MENTION_PATH_PATTERN.test(url)
	);
}

function isAllowedMarkdownUrl(url: string): boolean {
	return normalizeMessageLink(url) !== null;
}
