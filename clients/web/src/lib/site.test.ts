import { describe, expect, it } from "vitest";
import {
	buildPublicPageHead,
	resolvePageTitle,
	resolveSiteUrl,
	siteConfig,
} from "./site";

type PublicPageHead = ReturnType<typeof buildPublicPageHead>;

describe("site metadata", () => {
	it("uses specific homepage metadata instead of repeating the brand", () => {
		const head = buildPublicPageHead();
		const title = readTitle(head);

		expect(title).toBe("OpenMeld | Cloud Agentic Loop Workspace");
		expect(title).not.toBe("OpenMeld - OpenMeld");
		expect(readCanonical(head)).toBe(siteConfig.url);
		expect(readMetaName(head, "robots")).toBe(siteConfig.robots);
		expect(readMetaProperty(head, "og:url")).toBe(siteConfig.url);
		expect(readMetaName(head, "twitter:title")).toBe(title);
	});

	it("formats route-specific public page metadata consistently", () => {
		const description =
			"How OpenMeld handles account, Space, connected-computer, agent, diagnostic, and support information.";

		const head = buildPublicPageHead({
			description,
			path: "/privacy",
			title: "Privacy Policy",
		});

		expect(readTitle(head)).toBe("Privacy Policy | OpenMeld");
		expect(readMetaName(head, "description")).toBe(description);
		expect(readCanonical(head)).toBe("https://openmeld.ai/privacy");
		expect(readMetaProperty(head, "og:url")).toBe(
			"https://openmeld.ai/privacy"
		);
		expect(readMetaProperty(head, "og:title")).toBe(
			"Privacy Policy | OpenMeld"
		);
		expect(readMetaName(head, "twitter:title")).toBe(
			"Privacy Policy | OpenMeld"
		);
	});

	it("normalizes public URLs and brand-only titles", () => {
		expect(resolveSiteUrl()).toBe(siteConfig.url);
		expect(resolveSiteUrl("privacy")).toBe("https://openmeld.ai/privacy");
		expect(resolvePageTitle("OpenMeld")).toBe(siteConfig.title);
	});

	it("can provide default metadata without route-level indexing directives", () => {
		const head = buildPublicPageHead({ includeRobots: false });

		expect(readMetaName(head, "robots")).toBeUndefined();
	});

	it("can provide default metadata without route-level URL directives", () => {
		const head = buildPublicPageHead({ includeCanonical: false });

		expect(readCanonical(head)).toBeUndefined();
		expect(readMetaProperty(head, "og:url")).toBeUndefined();
	});
});

function readTitle(head: PublicPageHead) {
	const entry = head.meta.find((meta) => "title" in meta);
	return entry && "title" in entry ? entry.title : undefined;
}

function readMetaName(head: PublicPageHead, name: string) {
	const entry = head.meta.find((meta) => "name" in meta && meta.name === name);
	return entry && "content" in entry ? entry.content : undefined;
}

function readMetaProperty(head: PublicPageHead, property: string) {
	const entry = head.meta.find(
		(meta) => "property" in meta && meta.property === property
	);
	return entry && "content" in entry ? entry.content : undefined;
}

function readCanonical(head: PublicPageHead) {
	return head.links.find((link) => link.rel === "canonical")?.href;
}
