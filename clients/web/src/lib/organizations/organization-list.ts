import type { OrganizationSummary } from "./organization-types";

const ORGANIZATION_LIST_INVALID_MESSAGE =
	"Organization list response is invalid.";

export function normalizeOrganizationList(
	input: unknown
): OrganizationSummary[] {
	if (!Array.isArray(input)) {
		throw new Error(ORGANIZATION_LIST_INVALID_MESSAGE);
	}

	return input.map((item) => {
		if (!item || typeof item !== "object") {
			throw new Error(ORGANIZATION_LIST_INVALID_MESSAGE);
		}

		const record = item as Record<string, unknown>;
		if (
			typeof record.id !== "string" ||
			typeof record.name !== "string" ||
			typeof record.slug !== "string" ||
			record.id.trim().length === 0 ||
			record.name.trim().length === 0 ||
			record.slug.trim().length === 0
		) {
			throw new Error(ORGANIZATION_LIST_INVALID_MESSAGE);
		}

		return {
			id: record.id,
			isPersonal: readOrganizationIsPersonal(record),
			logo: typeof record.logo === "string" ? record.logo : null,
			name: record.name,
			slug: record.slug,
		};
	});
}

function readOrganizationIsPersonal(record: Record<string, unknown>): boolean {
	if (record.isPersonal === true) {
		return true;
	}

	const metadata = readOrganizationMetadata(record.metadata);
	return metadata?.personal === true;
}

function readOrganizationMetadata(
	metadata: unknown
): Record<string, unknown> | null {
	if (metadata === null || metadata === undefined) {
		return null;
	}

	if (typeof metadata === "string") {
		try {
			const parsed = JSON.parse(metadata) as unknown;
			return isPlainMetadataRecord(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}

	return isPlainMetadataRecord(metadata) ? metadata : null;
}

function isPlainMetadataRecord(
	value: unknown
): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
