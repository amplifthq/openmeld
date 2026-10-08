import {
	FEISHU_CHANNEL_IDENTITY,
	findPluginDefinition,
	LARK_CHANNEL_IDENTITY,
	pluginFromProvider,
} from "@openmeld/product-catalog/plugins";
import { describe, expect, it } from "vitest";

describe("Message channel identities", () => {
	it("uses the Feishu mark for both Lark platform variants", () => {
		expect(LARK_CHANNEL_IDENTITY.logoPath).toBe("/app-logos/feishu.svg");
		expect(FEISHU_CHANNEL_IDENTITY.logoPath).toBe(
			LARK_CHANNEL_IDENTITY.logoPath
		);
	});
});

describe("Plugin catalog connection paths", () => {
	it("connects a catalog provider without a static product entry and preserves optional fields", () => {
		const provider = {
			service: "new_provider",
			displayName: "New Provider",
			authTypes: ["api_key"],
			categories: [],
			homepageUrl: null,
			iconUrl: null,
			connectionAuth: {
				oauth: false,
				credentials: [
					{
						authType: "api_key" as const,
						fields: [
							{
								key: "apiKey",
								label: "API key",
								description: "",
								secret: true,
								required: true,
							},
							{
								key: "region",
								label: "Region",
								description: "",
								secret: false,
								required: false,
							},
						],
					},
				],
			},
		};
		expect(findPluginDefinition(provider.service)).toBeNull();
		expect(
			pluginFromProvider({
				...provider,
				connectionAuth: {
					oauth: false,
					credentials: [
						...provider.connectionAuth.credentials,
						{
							authType: "custom_credential",
							fields: [
								{
									key: "privateKey",
									label: "Private key",
									description: "PEM",
									secret: true,
									required: true,
									inputType: "textarea",
								},
							],
						},
					],
				},
			})
		).toMatchObject({
			connection: {
				credentials: [
					{ authType: "api_key" },
					{
						authType: "custom_credential",
						fields: [{ inputType: "textarea", secret: true }],
					},
				],
			},
		});
		expect(pluginFromProvider(provider)).toMatchObject({
			availability: "available",
			connection: {
				auth: {
					kind: "credential",
					fields: expect.arrayContaining([
						expect.objectContaining({ key: "region", required: false }),
					]),
				},
			},
		});
		expect(
			pluginFromProvider({
				...provider,
				connectionAuth: { oauth: false, credentials: [] },
			})
		).toMatchObject({ availability: "planned", connection: null });
	});

	it("connects Figma through OpenMeld's public OAuth plugin", () => {
		const figma = findPluginDefinition("figma");

		expect(figma).toMatchObject({
			availability: "available",
			connection: {
				auth: { kind: "oauth" },
			},
		});
	});

	it("connects Cloudflare Browser Rendering through OAuth by default", () => {
		const browserRendering = findPluginDefinition(
			"cloudflare_browser_rendering"
		);

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
		const notion = findPluginDefinition("notion");

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
