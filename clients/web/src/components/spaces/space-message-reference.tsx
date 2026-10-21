import { ChatCircleIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { MessageLinksText } from "./message-links-text";

const SPACE_REFERENCE_PATH_PATTERN = /\/spaces?\/([0-9a-f]{64})/gi;
const SPACE_REFERENCE_LEFT_DELIMITER_PATTERN = /[\s([{<"'“‘—–]/u;
const SPACE_REFERENCE_RIGHT_DELIMITER_PATTERN = /[\s,;:)}\]>"'”’…、，；：]/u;
const SPACE_REFERENCE_TERMINAL_PUNCTUATION_PATTERN = /[.!?。！？]/u;
const SPACE_REFERENCE_AFTER_TERMINAL_PATTERN = /[\s,;:)}\]>"'”’…、，；：]/u;

export type SpaceMessageReference = {
	href?: string;
	name: string | null;
	spaceId: string;
};

export type SpaceMessageReferencesById = ReadonlyMap<
	string,
	SpaceMessageReference
>;

export const EMPTY_SPACE_MESSAGE_REFERENCES: SpaceMessageReferencesById =
	new Map();

type SpaceMessageTextSegment =
	| { kind: "text"; value: string }
	| {
			kind: "space_reference";
			offset: number;
			rawPath: string;
			spaceId: string;
	  };

type MarkdownNode = {
	children?: MarkdownNode[];
	type: string;
	url?: string;
	value?: string;
};

const MARKDOWN_REFERENCE_DESCENT_BLOCKLIST = new Set([
	"code",
	"inlineCode",
	"link",
	"linkReference",
]);

export function collectSpaceMessageReferenceIds(
	texts: readonly string[]
): readonly string[] {
	const spaceIds = new Set<string>();
	for (const text of texts) {
		for (const segment of splitSpaceMessageReferenceText(text)) {
			if (segment.kind === "space_reference") {
				spaceIds.add(segment.spaceId);
			}
		}
	}

	return [...spaceIds];
}

export function SpaceMessageReferenceText(input: {
	referencesById: SpaceMessageReferencesById;
	text: string;
}) {
	let offset = 0;
	return (
		<>
			{splitSpaceMessageReferenceText(input.text).map((segment) => {
				const start = offset;
				offset +=
					segment.kind === "text"
						? segment.value.length
						: segment.rawPath.length;
				if (segment.kind === "text") {
					return (
						<MessageLinksText key={`text:${start}`} text={segment.value} />
					);
				}

				const reference = input.referencesById.get(segment.spaceId);
				if (!reference) {
					return segment.rawPath;
				}

				return (
					<SpaceMessageReferenceLink
						key={`${segment.spaceId}:${segment.offset}`}
						reference={reference}
					/>
				);
			})}
		</>
	);
}

export function hasResolvedSpaceMessageReference(input: {
	referencesById: SpaceMessageReferencesById;
	text: string;
}): boolean {
	return splitSpaceMessageReferenceText(input.text).some(
		(segment) =>
			segment.kind === "space_reference" &&
			input.referencesById.has(segment.spaceId)
	);
}

type SpaceMessageReferenceRemarkOptions = {
	references: readonly (readonly [string, SpaceMessageReference])[];
};

// A module-level attacher with plain options, rather than a closure, lets the
// rendered Markdown cache recognize the same pipeline across remounts.
export function createSpaceMessageReferenceRemarkPlugin(
	referencesById: SpaceMessageReferencesById
) {
	const plugin: [
		typeof spaceMessageReferenceRemarkPlugin,
		SpaceMessageReferenceRemarkOptions,
	] = [
		spaceMessageReferenceRemarkPlugin,
		{
			references: [...referencesById].map(
				([id, reference]) =>
					[
						id,
						{
							href: reference.href,
							name: reference.name,
							spaceId: reference.spaceId,
						},
					] as const
			),
		},
	];
	return plugin;
}

function spaceMessageReferenceRemarkPlugin(
	options: SpaceMessageReferenceRemarkOptions
) {
	const referencesById: SpaceMessageReferencesById = new Map(
		options.references
	);
	return (tree: MarkdownNode) => {
		transformMarkdownSpaceReferences(tree, referencesById);
	};
}

export function renderSpaceMessageInternalLink(input: {
	children: ReactNode;
	href: string;
	referencesById: SpaceMessageReferencesById;
}): ReactNode {
	const spaceId = input.href.slice("/spaces/".length);
	const reference = input.referencesById.get(spaceId);
	if (!reference) {
		return input.children;
	}

	return <SpaceMessageReferenceLink reference={reference} />;
}

function SpaceMessageReferenceLink(input: {
	reference: SpaceMessageReference;
}) {
	const label = resolveSpaceMessageReferenceLabel(input.reference);

	return (
		<Link
			aria-label={`Open Space ${label}`}
			className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-baseline font-medium text-foreground text-xs no-underline transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
			to={input.reference.href ?? `/spaces/${input.reference.spaceId}`}
		>
			<ChatCircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
			<span className="truncate">{label}</span>
		</Link>
	);
}

function resolveSpaceMessageReferenceLabel(
	reference: SpaceMessageReference
): string {
	const name = reference.name?.trim();
	if (name) {
		return name;
	}

	return `${reference.spaceId.slice(0, 8)}…${reference.spaceId.slice(-4)}`;
}

function splitSpaceMessageReferenceText(
	text: string
): readonly SpaceMessageTextSegment[] {
	const segments: SpaceMessageTextSegment[] = [];
	let cursor = 0;

	for (const match of text.matchAll(SPACE_REFERENCE_PATH_PATTERN)) {
		const matchIndex = match.index;
		const rawPath = match[0];
		const matchedSpaceId = match[1];
		if (matchIndex === undefined || !rawPath || !matchedSpaceId) {
			continue;
		}
		if (
			!(
				hasSpaceReferenceLeftDelimiter(text, matchIndex) &&
				hasSpaceReferenceRightDelimiter(text, matchIndex + rawPath.length)
			)
		) {
			continue;
		}
		const spaceId = matchedSpaceId.toLowerCase();

		if (matchIndex > cursor) {
			segments.push({ kind: "text", value: text.slice(cursor, matchIndex) });
		}
		segments.push({
			kind: "space_reference",
			offset: matchIndex,
			rawPath,
			spaceId,
		});
		cursor = matchIndex + rawPath.length;
	}

	if (cursor < text.length || segments.length === 0) {
		segments.push({ kind: "text", value: text.slice(cursor) });
	}

	return segments;
}

function hasSpaceReferenceLeftDelimiter(text: string, start: number): boolean {
	if (start === 0) {
		return true;
	}

	return SPACE_REFERENCE_LEFT_DELIMITER_PATTERN.test(text[start - 1] ?? "");
}

function hasSpaceReferenceRightDelimiter(text: string, end: number): boolean {
	const nextCharacter = text[end];
	if (nextCharacter === undefined) {
		return true;
	}
	if (SPACE_REFERENCE_RIGHT_DELIMITER_PATTERN.test(nextCharacter)) {
		return true;
	}
	if (!SPACE_REFERENCE_TERMINAL_PUNCTUATION_PATTERN.test(nextCharacter)) {
		return false;
	}

	let punctuationEnd = end + 1;
	while (
		SPACE_REFERENCE_TERMINAL_PUNCTUATION_PATTERN.test(
			text[punctuationEnd] ?? ""
		)
	) {
		punctuationEnd += 1;
	}
	const afterPunctuation = text[punctuationEnd];
	return (
		afterPunctuation === undefined ||
		SPACE_REFERENCE_AFTER_TERMINAL_PATTERN.test(afterPunctuation)
	);
}

function transformMarkdownSpaceReferences(
	node: MarkdownNode,
	referencesById: SpaceMessageReferencesById
): void {
	if (MARKDOWN_REFERENCE_DESCENT_BLOCKLIST.has(node.type) || !node.children) {
		return;
	}

	const transformedChildren: MarkdownNode[] = [];
	for (const child of node.children) {
		if (child.type === "text" && typeof child.value === "string") {
			for (const segment of splitSpaceMessageReferenceText(child.value)) {
				if (segment.kind === "text") {
					transformedChildren.push({ type: "text", value: segment.value });
					continue;
				}

				const reference = referencesById.get(segment.spaceId);
				if (!reference) {
					transformedChildren.push({
						type: "text",
						value: segment.rawPath,
					});
					continue;
				}

				transformedChildren.push({
					children: [
						{
							type: "text",
							value: resolveSpaceMessageReferenceLabel(reference),
						},
					],
					type: "link",
					url: reference.href ?? `/spaces/${reference.spaceId}`,
				});
			}
			continue;
		}

		transformMarkdownSpaceReferences(child, referencesById);
		transformedChildren.push(child);
	}

	node.children = transformedChildren;
}
