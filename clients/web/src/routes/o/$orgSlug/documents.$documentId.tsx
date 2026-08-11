import { createFileRoute } from "@tanstack/react-router";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { OrganizationDocumentDetailPage } from "#/components/organization-documents/organization-document-detail-page";

export const Route = createFileRoute("/o/$orgSlug/documents/$documentId")({
	component: DocumentDetailRoute,
});

function DocumentDetailRoute() {
	const { documentId } = Route.useParams();
	return (
		<AppFullWidthLayout>
			<OrganizationDocumentDetailPage documentId={documentId} />
		</AppFullWidthLayout>
	);
}
