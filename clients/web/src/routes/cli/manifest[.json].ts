import { env as cloudflareEnv } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
	buildCliBinaryManifestHeaders,
	readCliBinaryManifest,
} from "#/lib/cli-binary-release";

export async function getCliBinaryManifest(): Promise<Response> {
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
		const manifest = await readCliBinaryManifest({ store: bucket });
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
			GET: () => getCliBinaryManifest(),
		},
	},
});
