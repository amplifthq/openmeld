import {
	type CliBinaryManifest,
	cliBinaryManifestSchema,
} from "@openmeld/schemas";

export const CLI_BINARY_MANIFEST_ROUTE_PATH = "/cli/manifest.json";
export const CLI_BINARY_DOWNLOAD_ROUTE_PREFIX = "/cli/download";
export const CLI_BINARY_MANIFEST_R2_OBJECT_KEY = "cli/manifest.json";
export const WINDOWS_INTERNAL_PREVIEW_MANIFEST_R2_OBJECT_KEY =
	"cli/windows-preview/manifest.json";

const CLI_BINARY_ARTIFACT_NAME_RE =
	/^(?!.*\.exe$)openmeld-cli-[a-z0-9]+-[a-z0-9]+-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\.gz)?$/u;
const WINDOWS_INTERNAL_PREVIEW_ARTIFACT_NAME_RE =
	/^openmeld-(?:(?:cli|service)-windows-x64-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|windows-process)-[a-f0-9]{64}\.exe$/u;

type CliBinaryManifestStore = {
	get: (key: string) => Promise<{ json: () => Promise<unknown> } | null>;
};

export function parseCliBinaryManifest(value: unknown): CliBinaryManifest {
	const parsed = cliBinaryManifestSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`Invalid OpenMeld CLI binary manifest: ${parsed.error.message}`
		);
	}

	return parsed.data;
}

export async function readCliBinaryManifest(input: {
	store: CliBinaryManifestStore;
	objectKey?: string;
}): Promise<CliBinaryManifest | null> {
	const object = await input.store.get(
		input.objectKey ?? CLI_BINARY_MANIFEST_R2_OBJECT_KEY
	);
	if (!object) {
		return null;
	}

	return parseCliBinaryManifest(await object.json());
}

export function resolveCliBinaryArtifactObjectKey(
	artifactName: string,
	channel: "stable" | "windows-preview" = "stable"
): string | null {
	const normalizedArtifactName = artifactName.trim();
	if (
		!(
			channel === "windows-preview"
				? WINDOWS_INTERNAL_PREVIEW_ARTIFACT_NAME_RE
				: CLI_BINARY_ARTIFACT_NAME_RE
		).test(normalizedArtifactName)
	) {
		return null;
	}
	return `cli/${channel === "windows-preview" ? "windows-preview/" : ""}${normalizedArtifactName}`;
}

export function buildCliBinaryManifestHeaders(input: {
	etag?: string | null;
}): Headers {
	const headers = new Headers({
		"cache-control": "public, max-age=60, s-maxage=60",
		"content-type": "application/json; charset=utf-8",
		"x-content-type-options": "nosniff",
	});

	if (input.etag) {
		headers.set("etag", input.etag);
	}

	return headers;
}

export function buildCliBinaryDownloadHeaders(input: {
	artifactName: string;
	etag?: string | null;
	sizeBytes?: number | null;
}): Headers {
	const headers = new Headers({
		"cache-control": "public, max-age=31536000, immutable",
		"content-disposition": `attachment; filename="${input.artifactName}"`,
		"content-type": input.artifactName.endsWith(".gz")
			? "application/gzip"
			: "application/octet-stream",
		"x-content-type-options": "nosniff",
	});

	if (input.sizeBytes !== null && input.sizeBytes !== undefined) {
		headers.set("content-length", String(input.sizeBytes));
	}

	if (input.etag) {
		headers.set("etag", input.etag);
	}

	return headers;
}
