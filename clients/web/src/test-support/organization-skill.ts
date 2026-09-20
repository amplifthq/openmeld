import type { OrganizationSkill } from "@openmeld/schemas/types";

export function createOrganizationSkillFixture(
	input: {
		id?: string;
		name?: string;
		version?: number;
		orgSlug?: string;
		instructions?: string;
		referenceContent?: string;
	} = {}
): OrganizationSkill {
	const id = input.id ?? "skill-one";
	const version = input.version ?? 1;
	const name = input.name ?? "first-skill";
	const release = {
		id: `${id}-release-${version}`,
		digest: String(version).repeat(64),
		createdAt: "2026-08-24T01:00:00.000Z",
		createdByUserId: "user-1",
		source: { kind: "created" as const },
	};
	return {
		id,
		version,
		name,
		organizationId: `org-${input.orgSlug ?? "acme"}`,
		description: "Review a shared working method.",
		enabled: true,
		createdAt: release.createdAt,
		updatedAt: release.createdAt,
		source: release.source,
		activeRelease: release,
		releases: [release],
		maintainerUserIds: ["user-1"],
		permissions: { canEdit: true, canManage: false },
		bundle: {
			files:
				input.referenceContent === undefined
					? []
					: [
							{
								path: "references/checklist.md",
								encoding: "utf8",
								mediaType: "text/markdown",
								content: input.referenceContent,
								size: new TextEncoder().encode(input.referenceContent)
									.byteLength,
							},
						],
			instructions: input.instructions ?? "Review the evidence.",
			portable: {
				name,
				description: "Review a shared working method.",
				allowedTools: null,
				compatibility: null,
				license: null,
				metadata: {},
			},
		},
	};
}
