const DEFAULT_SITE_URL = "https://openmeld.ai";
const DEFAULT_PATH = "/";
const PROTOCOL_PREFIX_REGEX = /^https?:\/\//i;
const TRAILING_SLASH_REGEX = /\/+$/;
const LEADING_SLASH_REGEX = /^\/+/;

type PublicPageHeadOptions = {
	description?: string;
	image?: string;
	includeCanonical?: boolean;
	includeRobots?: boolean;
	path?: string;
	robots?: string;
	title?: string;
	twitterImage?: string;
};

function normalizeSiteUrl(rawUrl: string | undefined): string {
	if (!rawUrl) {
		return DEFAULT_SITE_URL;
	}

	const trimmed = rawUrl.trim();
	if (!trimmed) {
		return DEFAULT_SITE_URL;
	}

	const normalized = PROTOCOL_PREFIX_REGEX.test(trimmed)
		? trimmed
		: `https://${trimmed}`;

	return normalized.replace(TRAILING_SLASH_REGEX, "");
}

const siteUrl = normalizeSiteUrl(import.meta.env.VITE_SITE_URL);

export const siteConfig = {
	name: "OpenMeld",
	title: "OpenMeld | Cloud Agentic Loop Workspace",
	description:
		"Coordinate humans, Spaces, and connected AI agents through one cloud workspace, then bring each reply or failure back into your team's collaboration loop.",
	keywords:
		"OpenMeld, AI agents, agentic workspace, cloud workspace, Codex, Claude Code, Cursor, OpenCode, team collaboration",
	robots:
		"index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
	url: siteUrl,
	ogImage: "/opengraph-image",
	twitterImage: "/twitter-image",
} as const;

function normalizePath(path: string | undefined): string {
	const trimmed = path?.trim();
	if (!(trimmed && trimmed !== DEFAULT_PATH)) {
		return DEFAULT_PATH;
	}

	return `/${trimmed.replace(LEADING_SLASH_REGEX, "")}`;
}

export function resolveSiteUrl(path?: string): string {
	const normalizedPath = normalizePath(path);
	if (normalizedPath === DEFAULT_PATH) {
		return siteConfig.url;
	}

	return `${siteConfig.url}${normalizedPath}`;
}

export function resolvePageTitle(title?: string): string {
	const normalizedTitle = title?.trim();
	if (!(normalizedTitle && normalizedTitle !== siteConfig.name)) {
		return siteConfig.title;
	}

	return `${normalizedTitle} | ${siteConfig.name}`;
}

export function buildPublicPageHead(options: PublicPageHeadOptions = {}) {
	const title = resolvePageTitle(options.title);
	const description = options.description?.trim() || siteConfig.description;
	const canonicalUrl = resolveSiteUrl(options.path);
	const ogImageUrl = resolveSiteUrl(options.image ?? siteConfig.ogImage);
	const robots = options.robots?.trim() || siteConfig.robots;
	const twitterImageUrl = resolveSiteUrl(
		options.twitterImage ?? options.image ?? siteConfig.twitterImage
	);

	return {
		meta: [
			{
				title,
			},
			{
				name: "description",
				content: description,
			},
			...(options.includeRobots === false
				? []
				: [
						{
							name: "robots",
							content: robots,
						},
					]),
			...(options.includeCanonical === false
				? []
				: [
						{
							property: "og:url",
							content: canonicalUrl,
						},
					]),
			{
				property: "og:title",
				content: title,
			},
			{
				property: "og:description",
				content: description,
			},
			{
				property: "og:image",
				content: ogImageUrl,
			},
			{
				name: "twitter:card",
				content: "summary_large_image",
			},
			{
				name: "twitter:title",
				content: title,
			},
			{
				name: "twitter:description",
				content: description,
			},
			{
				name: "twitter:image",
				content: twitterImageUrl,
			},
		],
		links:
			options.includeCanonical === false
				? []
				: [
						{
							rel: "canonical",
							href: canonicalUrl,
						},
					],
	};
}
