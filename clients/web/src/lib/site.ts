const DEFAULT_SITE_URL = "https://openmeld.ai";
const DEFAULT_PATH = "/";
const PROTOCOL_PREFIX_REGEX = /^https?:\/\//i;
const TRAILING_SLASH_REGEX = /\/+$/;
const LEADING_SLASH_REGEX = /^\/+/;

type PublicPageHeadOptions = {
	description?: string;
	image?: string;
	imageAlt?: string;
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
	title: "OpenMeld | Operating System for Agent-Native Teams",
	description:
		"Open-source operating system for agent-native teams of people and machines. Connect local agents, shared context, and team workflows in one place.",
	keywords:
		"OpenMeld, open-source operating system, agent-native teams, AI agents, local agents, Center Agent, agent collaboration, Slack",
	robots:
		"index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
	url: siteUrl,
	ogImage: "/brand/openmeld-letter-o-glow-black-1024.jpg",
	socialImageAlt: "OpenMeld",
	twitterImage: "/brand/openmeld-letter-o-glow-black-1024.jpg",
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
	const imageAlt = options.imageAlt?.trim() || siteConfig.socialImageAlt;
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
				property: "og:image:alt",
				content: imageAlt,
			},
			{
				name: "twitter:card",
				content: "summary",
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
			{
				name: "twitter:image:alt",
				content: imageAlt,
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
