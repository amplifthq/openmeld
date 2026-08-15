import type { OrganizationDocumentFolder } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	resolveDocumentMoveTargets,
	resolveFolderMoveTargets,
} from "./organization-document-browser-model";

const CREATED_AT = "2026-08-15T00:00:00.000Z";

describe("Organization document browser move targets", () => {
	it("never offers OpenMeld-managed folders as manual move destinations", () => {
		const folders: OrganizationDocumentFolder[] = [
			folder({
				id: "profile-reports",
				isManaged: true,
				name: "Profile Reports",
			}),
			folder({
				id: "profile-alex",
				isManaged: true,
				name: "Alex Kim",
				parentFolderId: "profile-reports",
			}),
			folder({ id: "runbooks", isManaged: false, name: "Runbooks" }),
		];

		expect(
			resolveDocumentMoveTargets({ currentFolderId: null, folders })
		).toEqual([{ id: "runbooks", label: "Runbooks" }]);
		expect(
			resolveFolderMoveTargets({
				folder: folders[2] as OrganizationDocumentFolder,
				folders,
			})
		).toEqual([]);
	});
});

function folder(input: {
	id: string;
	isManaged: boolean;
	name: string;
	parentFolderId?: string | null;
}): OrganizationDocumentFolder {
	return {
		createdAt: CREATED_AT,
		id: input.id,
		isManaged: input.isManaged,
		name: input.name,
		organizationId: "org-1",
		parentFolderId: input.parentFolderId ?? null,
		updatedAt: CREATED_AT,
	};
}
