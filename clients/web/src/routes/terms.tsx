import { createFileRoute } from "@tanstack/react-router";
import { TermsOfServicePage } from "#/components/legal/terms-of-service-page";
import { buildPublicPageHead } from "#/lib/site";

const TERMS_DESCRIPTION =
	"Terms governing use of OpenMeld's experimental collaboration service, local agent connections, and connected Plugins.";

export const Route = createFileRoute("/terms")({
	head: () => ({
		...buildPublicPageHead({
			description: TERMS_DESCRIPTION,
			path: "/terms",
			title: "Terms of Service",
		}),
	}),
	component: TermsRoute,
});

function TermsRoute() {
	return <TermsOfServicePage />;
}
