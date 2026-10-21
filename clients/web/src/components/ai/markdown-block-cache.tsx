import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { urlAttributes } from "html-url-attributes";
import {
	createContext,
	memo,
	type ReactElement,
	type ReactNode,
	useContext,
} from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { Block, type BlockProps, parseMarkdownIntoBlocks } from "streamdown";
import { type PluggableList, type Processor, unified } from "unified";
import { visit } from "unist-util-visit";

/**
 * A bounded, module-level cache of rendered Streamdown blocks.
 *
 * Streamdown memoizes parsing inside one mounted instance only, so every
 * remount of a finalized message (a Space switch, a remounted conversation)
 * parses and sanitizes all of its Markdown again. This cache keeps the final
 * React element of each block, produced by the same remark -> rehype ->
 * sanitize -> URL policy -> JSX pipeline as Streamdown's own Block, so a
 * remount reuses the sanitized result instead of parsing it again.
 *
 * Safety rules:
 * - Only pipeline output is cached: never raw Markdown or an unsanitized tree.
 * - The key is derived from the block's own props, so it always names the
 *   pipeline that produced the output: block text, component map, remark and
 *   rehype plugins (functions by identity, options by value), and the URL and
 *   element policies. A caller cannot hand the cache a mislabeled pipeline.
 * - Function identity never collides: two functions with the same minified
 *   name still get different keys. A closure created per render simply never
 *   hits, which is correct but uncached.
 * - Streaming output is not cached: an incomplete block, or any block below a
 *   disabled `MarkdownBlockCacheScope`, renders through Streamdown's Block.
 */

type HastNodes = Parameters<typeof toJsxRuntime>[0];
type Root = Extract<HastNodes, { type: "root" }>;
type Element = Extract<HastNodes, { type: "element" }>;
type Parents = Extract<HastNodes, { children: unknown }>;
// Streamdown bundles its own hast types; its policy callbacks take these.
type StreamdownElement = Parameters<NonNullable<BlockProps["allowElement"]>>[0];
type StreamdownParent = Parameters<NonNullable<BlockProps["allowElement"]>>[2];

const MAX_CACHED_BLOCKS = 1500;
const MAX_CACHED_BLOCK_CHARACTERS = 600_000;
const MAX_CACHED_SPLITS = 500;
const MAX_CACHED_SPLIT_CHARACTERS = 600_000;
const MAX_CACHED_PROCESSORS = 64;
const EMPTY_PLUGINS: PluggableList = [];
const REMARK_REHYPE_OPTIONS = { allowDangerousHtml: true } as const;

type CachedBlock = { element: ReactElement; size: number };

const blocks = new Map<string, CachedBlock>();
let cachedBlockCharacters = 0;
const splits = new Map<string, string[]>();
let cachedSplitCharacters = 0;
const processors = new Map<string, Processor<Root, Root, Root>>();
const identityIds = new WeakMap<object, number>();
let nextIdentityId = 1;
const valueKeys = new WeakMap<object, string>();

const MarkdownBlockCacheEnabledContext = createContext(false);

/**
 * Enables block caching below it. Disable it while a message is still
 * streaming, so intermediate text never fills the cache.
 */
export function MarkdownBlockCacheScope(input: {
	children: ReactNode;
	enabled: boolean;
}) {
	return (
		<MarkdownBlockCacheEnabledContext value={input.enabled}>
			{input.children}
		</MarkdownBlockCacheEnabledContext>
	);
}

/**
 * Streamdown's own block splitter, memoized across mounts. The returned array
 * is shared; Streamdown only reads it.
 */
export function parseMarkdownIntoCachedBlocks(markdown: string): string[] {
	const cached = splits.get(markdown);
	if (cached) {
		touch(splits, markdown, cached);
		return cached;
	}
	const result = parseMarkdownIntoBlocks(markdown);
	if (markdown.length > MAX_CACHED_SPLIT_CHARACTERS) {
		return result;
	}
	splits.set(markdown, result);
	cachedSplitCharacters += markdown.length;
	while (
		splits.size > MAX_CACHED_SPLITS ||
		cachedSplitCharacters > MAX_CACHED_SPLIT_CHARACTERS
	) {
		const oldest = splits.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		splits.delete(oldest);
		cachedSplitCharacters -= oldest.length;
	}
	return result;
}

/** Streamdown `BlockComponent` that reuses rendered, sanitized blocks. */
export const CachedMarkdownBlock = memo(function CachedMarkdownBlock(
	props: BlockProps
) {
	const enabled = useContext(MarkdownBlockCacheEnabledContext);
	if (
		!enabled ||
		props.isIncomplete ||
		props.animatePlugin ||
		props.shouldNormalizeHtmlIndentation ||
		props.dir
	) {
		return <Block {...props} />;
	}
	return readCachedBlock(props);
});

function readCachedBlock(props: BlockProps): ReactElement {
	const pipelineKey = resolvePipelineKey(props);
	const key = `${pipelineKey}\u0000${props.content}`;
	const cached = blocks.get(key);
	if (cached) {
		touch(blocks, key, cached);
		return cached.element;
	}
	const element = renderMarkdownBlock(pipelineKey, props);
	const size = props.content.length;
	if (size > MAX_CACHED_BLOCK_CHARACTERS) {
		return element;
	}
	blocks.set(key, { element, size });
	cachedBlockCharacters += size;
	while (
		blocks.size > MAX_CACHED_BLOCKS ||
		cachedBlockCharacters > MAX_CACHED_BLOCK_CHARACTERS
	) {
		const oldest = blocks.entries().next().value;
		if (!oldest) {
			break;
		}
		blocks.delete(oldest[0]);
		cachedBlockCharacters -= oldest[1].size;
	}
	return element;
}

function resolvePipelineKey(props: BlockProps): string {
	return [
		resolveValueKey(props.components, resolveComponentsKey),
		resolveValueKey(props.remarkPlugins, resolvePluginsKey),
		resolveValueKey(props.rehypePlugins, resolvePluginsKey),
		resolveValueKey(props.remarkRehypeOptions, resolveOptionsKey),
		resolveValueKey(props.allowedElements, JSON.stringify),
		resolveValueKey(props.disallowedElements, JSON.stringify),
		resolveIdentityKey(props.allowElement),
		resolveIdentityKey(props.urlTransform),
		props.skipHtml ? "skip" : "keep",
		props.unwrapDisallowed ? "unwrap" : "drop",
	].join("|");
}

/** Memoizes a key per object identity; Streamdown keeps these stable per mount. */
function resolveValueKey<T extends object>(
	value: T | undefined,
	resolve: (value: T) => string
): string {
	if (value === undefined) {
		return "";
	}
	const cached = valueKeys.get(value);
	if (cached !== undefined) {
		return cached;
	}
	const key = resolve(value);
	valueKeys.set(value, key);
	return key;
}

function resolveComponentsKey(
	components: NonNullable<BlockProps["components"]>
): string {
	return Object.entries(components)
		.map(([name, component]) => `${name}=${resolveIdentityKey(component)}`)
		.sort()
		.join(",");
}

function resolvePluginsKey(plugins: PluggableList): string {
	return plugins
		.map((plugin) => {
			if (Array.isArray(plugin)) {
				const [attacher, ...options] = plugin;
				return `${resolveIdentityKey(attacher)}:${resolveOptionsKey(options)}`;
			}
			return resolveIdentityKey(plugin);
		})
		.join(",");
}

/** Value key for plain JSON data; identity key for anything else. */
function resolveOptionsKey(value: unknown): string {
	return isPlainJson(value)
		? `j${JSON.stringify(value)}`
		: resolveIdentityKey(value);
}

// JSON.stringify maps Maps, Sets, class instances and non-finite numbers to
// keys that collide, and throws on cycles, so only plain data keys by value.
function isPlainJson(value: unknown, seen = new Set<object>()): boolean {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return true;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) && !Object.is(value, -0);
	}
	if (typeof value !== "object" || seen.has(value)) {
		return false;
	}
	const proto = Object.getPrototypeOf(value);
	if (!(Array.isArray(value) || proto === Object.prototype || proto === null)) {
		return false;
	}
	seen.add(value);
	const plain = Object.values(value).every((child) => isPlainJson(child, seen));
	seen.delete(value);
	return plain;
}

function resolveIdentityKey(value: unknown): string {
	if (value === undefined) {
		return "";
	}
	if (
		value === null ||
		(typeof value !== "object" && typeof value !== "function")
	) {
		return `v${JSON.stringify(value)}`;
	}
	let id = identityIds.get(value);
	if (id === undefined) {
		id = nextIdentityId;
		nextIdentityId += 1;
		identityIds.set(value, id);
	}
	return `#${id}`;
}

/**
 * Mirrors Streamdown 2.5's internal block renderer: parse, run the remark
 * and rehype plugins (including sanitization), apply the URL and element
 * policies, then convert to JSX. `markdown-block-cache.test.tsx` pins the
 * output against Streamdown's own Block.
 */
function renderMarkdownBlock(
	pipelineKey: string,
	props: BlockProps
): ReactElement {
	const processor = resolveProcessor(pipelineKey, props);
	const tree = processor.runSync(processor.parse(props.content), props.content);
	applyElementPolicies(tree, props);
	return toJsxRuntime(tree, {
		Fragment,
		components: props.components,
		ignoreInvalidStyle: true,
		jsx,
		jsxs,
		passKeys: true,
		passNode: true,
	});
}

function resolveProcessor(
	pipelineKey: string,
	props: BlockProps
): Processor<Root, Root, Root> {
	const cached = processors.get(pipelineKey);
	if (cached) {
		touch(processors, pipelineKey, cached);
		return cached;
	}
	const rehypePlugins = props.rehypePlugins ?? EMPTY_PLUGINS;
	const remarkPlugins = props.remarkPlugins ?? EMPTY_PLUGINS;
	// Streamdown 2.5 turns raw HTML into text unless rehype-raw is configured.
	// MessageResponse never configures rehype-raw.
	const processor = unified()
		.use(remarkParse)
		.use([...remarkPlugins, rawHtmlAsTextRemarkPlugin])
		.use(remarkRehype, {
			...REMARK_REHYPE_OPTIONS,
			...props.remarkRehypeOptions,
		})
		.use(rehypePlugins) as unknown as Processor<Root, Root, Root>;
	processors.set(pipelineKey, processor);
	evictOldest(processors, MAX_CACHED_PROCESSORS);
	return processor;
}

type MarkdownParent = { children: { type: string; value?: string }[] };

function rawHtmlAsTextRemarkPlugin() {
	return (tree: Parameters<typeof visit>[0]) => {
		visit(tree, "html", (node, index, parent) => {
			if (parent && typeof index === "number") {
				(parent as MarkdownParent).children[index] = {
					type: "text",
					value: (node as { value?: string }).value ?? "",
				};
			}
		});
	};
}

function applyElementPolicies(tree: Root, props: BlockProps) {
	const {
		allowElement,
		allowedElements,
		disallowedElements,
		skipHtml,
		unwrapDisallowed,
		urlTransform,
	} = props;
	if (
		!(
			allowElement ||
			allowedElements ||
			disallowedElements ||
			skipHtml ||
			urlTransform
		)
	) {
		return;
	}
	const transform = urlTransform ?? ((url: string) => url);
	visit(tree, (node: HastNodes, index, parent: Parents | undefined) => {
		if (node.type === "raw" && parent && typeof index === "number") {
			if (skipHtml) {
				parent.children.splice(index, 1);
			} else {
				parent.children[index] = { type: "text", value: node.value };
			}
			return index;
		}
		if (node.type !== "element") {
			return;
		}
		transformElementUrls(node, transform);
		let remove = false;
		if (allowedElements) {
			remove = !allowedElements.includes(node.tagName);
		} else if (disallowedElements) {
			remove = disallowedElements.includes(node.tagName);
		}
		if (!remove && allowElement && typeof index === "number") {
			remove = !allowElement(
				node as unknown as StreamdownElement,
				index,
				parent as unknown as StreamdownParent
			);
		}
		if (remove && parent && typeof index === "number") {
			if (unwrapDisallowed && node.children) {
				parent.children.splice(index, 1, ...node.children);
			} else {
				parent.children.splice(index, 1);
			}
			return index;
		}
		return;
	});
}

function transformElementUrls(
	node: Element,
	transform: NonNullable<BlockProps["urlTransform"]>
) {
	for (const attribute in urlAttributes) {
		if (
			Object.hasOwn(urlAttributes, attribute) &&
			Object.hasOwn(node.properties, attribute)
		) {
			const value = node.properties[attribute];
			const tagNames = urlAttributes[attribute];
			if (tagNames === null || tagNames.includes(node.tagName)) {
				node.properties[attribute] =
					transform(
						String(value || ""),
						attribute,
						node as unknown as StreamdownElement
					) ?? undefined;
			}
		}
	}
}

function touch<K, V>(map: Map<K, V>, key: K, value: V) {
	map.delete(key);
	map.set(key, value);
}

function evictOldest<K, V>(map: Map<K, V>, maxSize: number) {
	while (map.size > maxSize) {
		const oldest = map.keys().next();
		if (oldest.done) {
			return;
		}
		map.delete(oldest.value);
	}
}

/** Test support: forget every cached block, split, and processor. */
export function clearMarkdownBlockCache() {
	blocks.clear();
	cachedBlockCharacters = 0;
	splits.clear();
	cachedSplitCharacters = 0;
	processors.clear();
}

/** Test support: the number of cached rendered blocks. */
export function readMarkdownBlockCacheSize(): number {
	return blocks.size;
}

/** Test-only view of how many split results are retained. */
export function readMarkdownSplitCacheSize(): number {
	return splits.size;
}
