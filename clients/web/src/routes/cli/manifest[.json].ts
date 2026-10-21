import { env as cloudflareEnv } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
	buildCliBinaryManifestHeaders,
	readCliBinaryManifest,
	WINDOWS_INTERNAL_PREVIEW_MANIFEST_R2_OBJECT_KEY,
} from "#/lib/cli-binary-release";
import { serveCliDownload } from "#/lib/cli-download-cache.server";

export async function getCliBinaryManifest(
	channel: "stable" | "windows-preview" = "stable"
): Promise<Response> {
	const bucket = cloudflareEnv.OPENMELD_DESKTOP_DOWNLOADS;
	if (!bucket) {
		return new Response("OpenMeld CLI binary downloads are not configured.", {
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"x-content-type-options": "nosniff",
			},
			status: 503,
		});
	}

	try {
		const manifest = await readCliBinaryManifest({
			store: bucket,
			...(channel === "windows-preview"
				? { objectKey: WINDOWS_INTERNAL_PREVIEW_MANIFEST_R2_OBJECT_KEY }
				: {}),
		});
		if (!manifest) {
			return new Response("OpenMeld CLI binary manifest is not uploaded yet.", {
				headers: {
					"cache-control": "no-store",
					"content-type": "text/plain; charset=utf-8",
					"x-content-type-options": "nosniff",
				},
				status: 404,
			});
		}
		if (channel === "windows-preview") {
			const cli = manifest.channels.stable.platforms["windows-x64"];
			const service =
				manifest.channels.stable.service?.platforms["windows-x64"];
			if (
				!(
					cli &&
					service &&
					"mode" in (cli.windows ?? {}) &&
					"mode" in (service.windows ?? {})
				) ||
				Object.keys(manifest.channels.stable.platforms).length !== 1
			) {
				throw new Error(
					"Windows preview manifest contains unexpected platforms."
				);
			}
		}

		return Response.json(manifest, {
			headers: buildCliBinaryManifestHeaders({}),
		});
	} catch (error) {
		console.error("Invalid OpenMeld CLI binary manifest.", error);
		return new Response("OpenMeld CLI binary release metadata is invalid.", {
			headers: {
				"cache-control": "no-store",
				"content-type": "text/plain; charset=utf-8",
				"x-content-type-options": "nosniff",
			},
			status: 500,
		});
	}
}

export const Route = createFileRoute("/cli/manifest.json")({
	server: {
		handlers: {
			GET: ({ request }) => {
				const channel =
					new URL(request.url).searchParams.get("channel") === "windows-preview"
						? "windows-preview"
						: "stable";
				return serveCliDownload(request, channel, () =>
					getCliBinaryManifest(channel)
				);
			},
		},
	},
});
