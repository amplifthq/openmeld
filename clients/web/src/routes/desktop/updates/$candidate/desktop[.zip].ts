import { env } from "cloudflare:workers";
import { desktopCandidateIdSchema } from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { readDesktopCandidate } from "#/lib/desktop-release";

export async function desktopUpdateDownload(
	candidate: string,
	includeBody: boolean
) {
	const headers = new Headers({
		"cache-control": "no-store",
		"content-type": "application/zip",
		"x-content-type-options": "nosniff",
	});
	if (!desktopCandidateIdSchema.safeParse(candidate).success) {
		return new Response("Invalid candidate.", { status: 400, headers });
	}
	try {
		const bucket = env.OPENMELD_DESKTOP_DOWNLOADS;
		if (!bucket) {
			return new Response(null, { status: 503, headers });
		}
		const release = await readDesktopCandidate(bucket, candidate);
		if (!release?.zip) {
			return new Response(null, { status: 404, headers });
		}
		let body: ReadableStream | null = null;
		const artifact = includeBody
			? await bucket.get(release.zipObjectKey).then((object) => {
					body = object?.body ?? null;
					return object;
				})
			: await bucket.head(release.zipObjectKey);
		if (!artifact) {
			return new Response(null, { status: 404, headers });
		}
		if (artifact.size !== release.zip.sizeBytes) {
			throw new Error("Desktop ZIP size mismatch.");
		}
		headers.set("content-length", String(artifact.size));
		headers.set("cache-control", "public, max-age=31536000, immutable");
		return new Response(body, { headers });
	} catch (error) {
		console.error("Desktop update download unavailable.", error);
		return new Response(null, { status: 503, headers });
	}
}
export const Route = createFileRoute("/desktop/updates/$candidate/desktop.zip")(
	{
		server: {
			handlers: {
				GET: ({ params }) => desktopUpdateDownload(params.candidate, true),
				HEAD: ({ params }) => desktopUpdateDownload(params.candidate, false),
			},
		},
	}
);
