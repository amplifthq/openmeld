import { describe, expect, it } from "vitest";
import {
	FEISHU_CHANNEL_IDENTITY,
	findAppDefinition,
	LARK_CHANNEL_IDENTITY,
} from "./app-catalog";

describe("Message channel identities", () => {
	it("uses the Feishu mark for both Lark platform variants", () => {
		expect(LARK_CHANNEL_IDENTITY.logoPath).toBe("/app-logos/feishu.svg");
		expect(FEISHU_CHANNEL_IDENTITY.logoPath).toBe(
			LARK_CHANNEL_IDENTITY.logoPath
		);
	});
});

describe("App catalog connection paths", () => {
	it("describes every Google App as read-only", () => {
		expect(findAppDefinition("gmail")?.description).toBe(
			"Find and read email without sending or changing messages."
		);
		expect(findAppDefinition("googlecalendar")?.description).toBe(
			"Find and read calendars and events without changing them."
		);
		expect(findAppDefinition("googledrive")?.description).toBe(
			"Find and read Drive files and metadata without changing them."
		);
	});

	it("connects Figma through OpenMeld's public OAuth app", () => {
		const figma = findAppDefinition("figma");

		expect(figma).toMatchObject({
			availability: "available",
			connection: {
				auth: { kind: "oauth" },
			},
		});
	});

	it("connects Cloudflare Browser Rendering through OAuth by default", () => {
		const browserRendering = findAppDefinition("cloudflare_browser_rendering");

		expect(browserRendering).toMatchObject({
			availability: "available",
			connection: {
				auth: {
					credentialFallback: {
						authType: "api_key",
						kind: "credential",
						switchLabel: "Use an API token instead",
					},
					kind: "oauth",
				},
			},
		});
	});

	it("connects Notion through OAuth by default with an internal token fallback", () => {
		const notion = findAppDefinition("notion");

		expect(notion).toMatchObject({
			availability: "available",
			connection: {
				auth: {
					credentialFallback: {
						authType: "api_key",
						kind: "credential",
						switchLabel: "Use an internal connection token instead",
					},
					kind: "oauth",
				},
			},
		});
	});
});
