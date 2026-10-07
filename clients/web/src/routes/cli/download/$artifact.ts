import { env as cloudflareEnv } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
	buildCliBinaryDownloadHeaders,
	resolveCliBinaryArtifactObjectKey,
} from "#/lib/cli-binary-release";

async function downloadCliBinaryArtifact(input: {
	artifactName: string;
	channel: "stable" | "windows-preview";
	includeBody: boolean;
}): Promise<Response> {
	const objectKey = resolveCliBinaryArtifactObjectKey(
		input.artifactName,
		input.channel
	);
	if (!objectKey) {
		return new Response("OpenMeld CLI binary artifact name is invalid.", {
			headers: {
				"cache-control": "no-store",
				"content-type": "text/plain; charset=utf-8",
				"x-content-type-options": "nosniff",
			},
			status: 400,
		});
	}

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

	const object = await bucket.get(objectKey);
	if (!object) {
		return new Response("OpenMeld CLI binary artifact is missing.", {
			headers: {
				"cache-control": "no-store",
				"content-type": "text/plain; charset=utf-8",
				"x-content-type-options": "nosniff",
			},
			status: 404,
		});
	}

	return new Response(input.includeBody ? object.body : null, {
		headers: buildCliBinaryDownloadHeaders({
			artifactName: input.artifactName,
			etag: object.httpEtag,
			sizeBytes: object.size,
		}),
	});
}

export const Route = createFileRoute("/cli/download/$artifact")({
	server: {
		handlers: {
			GET: ({ params, request }) =>
				downloadCliBinaryArtifact({
					artifactName: params.artifact,
					channel:
						new URL(request.url).searchParams.get("channel") ===
						"windows-preview"
							? "windows-preview"
							: "stable",
					includeBody: true,
				}),
			HEAD: ({ params, request }) =>
				downloadCliBinaryArtifact({
					artifactName: params.artifact,
					channel:
						new URL(request.url).searchParams.get("channel") ===
						"windows-preview"
							? "windows-preview"
							: "stable",
					includeBody: false,
				}),
		},
	},
});
