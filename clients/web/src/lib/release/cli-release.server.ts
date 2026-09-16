import { cliBinaryManifestSchema, cliReleaseSchema } from "@openmeld/schemas";
import { getCliBinaryManifest } from "#/routes/cli/manifest[.json]";

/** The published binary channel remains the version owner. No npm fallback. */
export async function getCliReleaseResponse(): Promise<Response> {
	const response = await getCliBinaryManifest();
	if (!response.ok) {
		return response;
	}
	const manifest = cliBinaryManifestSchema.parse(await response.json());
	return Response.json(
		cliReleaseSchema.parse({ version: manifest.channels.stable.version }),
		{
			headers: {
				"cache-control": response.headers.get("cache-control") ?? "no-store",
			},
		}
	);
}
