import { createFileRoute } from "@tanstack/react-router";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { OrganizationDocumentsPage } from "#/components/organization-documents/organization-documents-page";

export const Route = createFileRoute("/o/$orgSlug/documents/")({
	validateSearch: (search: Record<string, unknown>) => ({
		folder:
			typeof search.folder === "string" && search.folder.trim()
				? search.folder.trim()
				: undefined,
	}),
	component: DocumentsIndexRoute,
});

function DocumentsIndexRoute() {
	const search = Route.useSearch();
	return (
		<AppFullWidthLayout>
			<OrganizationDocumentsPage folderId={search.folder} />
		</AppFullWidthLayout>
	);
}
