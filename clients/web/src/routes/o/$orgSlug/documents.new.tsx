import type { OrganizationDocumentKind } from "@openmeld/schemas/types";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/o/$orgSlug/documents/new")({
	validateSearch: (search: Record<string, unknown>) => ({
		folder:
			typeof search.folder === "string" && search.folder.trim()
				? search.folder.trim()
				: undefined,
		kind: parseKind(search.kind),
		subjectUserId:
			typeof search.subjectUserId === "string" && search.subjectUserId.trim()
				? search.subjectUserId.trim()
				: undefined,
	}),
	beforeLoad: ({ params, search }) => {
		throw redirect({
			to: "/o/$orgSlug/files",
			params,
			search: {
				view: "knowledge",
				create: "1",
				folder: search.folder,
				kind: search.kind,
				subjectUserId: search.subjectUserId,
				document: undefined,
			},
			replace: true,
		});
	},
});

function parseKind(value: unknown): OrganizationDocumentKind | undefined {
	return value === "brief" ||
		value === "member_profile" ||
		value === "knowledge"
		? value
		: undefined;
}
