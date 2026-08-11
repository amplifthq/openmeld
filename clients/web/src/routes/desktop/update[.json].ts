import { env as cloudflareEnv } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
	buildDesktopReleaseOrigin,
	buildDesktopUpdateManifest,
	readDesktopPreviewReleaseManifest,
} from "#/lib/desktop-release";

export async function getDesktopUpdateManifest(
	request: Request
): Promise<Response> {
	const bucket = cloudflareEnv.OPENMELD_DESKTOP_DOWNLOADS;
	if (!bucket) {
		return new Response("OpenMeld Desktop downloads are not configured.", {
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"x-content-type-options": "nosniff",
			},
			status: 503,
		});
	}

	try {
		const releaseManifest = await readDesktopPreviewReleaseManifest({
			store: bucket,
		});
		if (!releaseManifest) {
			return new Response("OpenMeld Desktop preview is not uploaded yet.", {
				headers: {
					"cache-control": "no-store",
					"content-type": "text/plain; charset=utf-8",
					"x-content-type-options": "nosniff",
				},
				status: 404,
			});
		}

		return Response.json(
			buildDesktopUpdateManifest({
				origin: buildDesktopReleaseOrigin(request.url),
				releaseManifest,
			}),
			{
				headers: {
					"cache-control": "public, max-age=60, s-maxage=60",
					"x-content-type-options": "nosniff",
				},
			}
		);
	} catch (error) {
		console.error("Invalid OpenMeld Desktop preview release manifest.", error);
		return new Response("OpenMeld Desktop release metadata is invalid.", {
			headers: {
				"cache-control": "no-store",
				"content-type": "text/plain; charset=utf-8",
				"x-content-type-options": "nosniff",
			},
			status: 500,
		});
	}
}

export const Route = createFileRoute("/desktop/update.json")({
	server: {
		handlers: {
			GET: ({ request }) => getDesktopUpdateManifest(request),
		},
	},
});
