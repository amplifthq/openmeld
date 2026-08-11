import type { OrganizationDocumentKind } from "@openmeld/schemas/types";
import { createFileRoute } from "@tanstack/react-router";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { OrganizationDocumentNewPage } from "#/components/organization-documents/organization-document-new-page";

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
	component: NewDocumentRoute,
});

function NewDocumentRoute() {
	const search = Route.useSearch();
	return (
		<AppFullWidthLayout>
			<OrganizationDocumentNewPage
				initialFolderId={search.folder}
				initialKind={search.kind}
				initialSubjectUserId={search.subjectUserId}
			/>
		</AppFullWidthLayout>
	);
}

function parseKind(value: unknown): OrganizationDocumentKind | undefined {
	return value === "brief" ||
		value === "member_profile" ||
		value === "knowledge"
		? value
		: undefined;
}
