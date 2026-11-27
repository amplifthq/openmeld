import { organizationDashboardArtifactSchema } from "@openmeld/schemas";
import type { OrganizationDashboardArtifact } from "@openmeld/schemas/types";
import { buildSpaceFileHtmlPreviewPath } from "#/components/spaces/space-file-html-document";

const REVISION_PATTERN = /^[1-9][0-9]*$/u;
const PARSE_ORIGIN = "https://openmeld.invalid";

export function buildDashboardArtifactLink(
	artifact: OrganizationDashboardArtifact,
	orgSlug: string
): string {
	return buildSpaceFileHtmlPreviewPath({
		...artifact,
		organizationSlug: orgSlug,
	});
}

export function parseDashboardArtifactLink(
	rawLink: string,
	orgSlug: string,
	origin = PARSE_ORIGIN
): OrganizationDashboardArtifact | null {
	const href = rawLink.trim();
	if (!href || href.length > 2048 || href.startsWith("//")) {
		return null;
	}
	try {
		const url = new URL(href, origin);
		if (
			url.origin !== origin ||
			url.pathname !== "/file-preview" ||
			url.username ||
			url.password
		) {
			return null;
		}
		const { searchParams } = url;
		if (searchParams.get("organizationSlug") !== orgSlug) {
			return null;
		}
		const spaceId = searchParams.get("spaceId") ?? "";
		const fileId = searchParams.get("fileId") ?? "";
		const revisionText = searchParams.get("revision") ?? "";
		const revision = Number(revisionText);
		if (!REVISION_PATTERN.test(revisionText)) {
			return null;
		}
		const parsed = organizationDashboardArtifactSchema.safeParse({
			spaceId,
			fileId,
			revision,
		});
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
