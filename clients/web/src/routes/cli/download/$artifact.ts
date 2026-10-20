import { env as cloudflareEnv } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
	buildCliBinaryDownloadHeaders,
	resolveCliBinaryArtifactObjectKey,
} from "#/lib/cli-binary-release";
import { serveCliDownload } from "#/lib/cli-download-cache.server";

export async function downloadCliBinaryArtifact(input: {
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

	let object: R2Object | null;
	let body: ReadableStream | null = null;
	if (input.includeBody) {
		const download = await bucket.get(objectKey);
		object = download;
		body = download?.body ?? null;
	} else {
		object = await bucket.head(objectKey);
	}
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

	return new Response(body, {
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
			GET: ({ params, request }) => {
				const channel =
					new URL(request.url).searchParams.get("channel") === "windows-preview"
						? "windows-preview"
						: "stable";
				return serveCliDownload(request, channel, () =>
					downloadCliBinaryArtifact({
						artifactName: params.artifact,
						channel,
						includeBody: true,
					})
				);
			},
			HEAD: ({ params, request }) => {
				const channel =
					new URL(request.url).searchParams.get("channel") === "windows-preview"
						? "windows-preview"
						: "stable";
				return serveCliDownload(request, channel, () =>
					downloadCliBinaryArtifact({
						artifactName: params.artifact,
						channel,
						includeBody: false,
					})
				);
			},
		},
	},
});
