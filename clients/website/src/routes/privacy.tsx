import { buildPublicPageHead } from "@openmeld/product-catalog/site";
import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPolicyPage } from "#/components/legal/privacy-policy-page";

const PRIVACY_DESCRIPTION =
	"How OpenMeld handles workspace content, local and hosted AI agents, connected services, memory, privacy controls, and account deletion.";

export const Route = createFileRoute("/privacy")({
	head: () => ({
		...buildPublicPageHead({
			description: PRIVACY_DESCRIPTION,
			path: "/privacy",
			title: "Privacy Policy",
		}),
	}),
	component: PrivacyRoute,
});

function PrivacyRoute() {
	return <PrivacyPolicyPage />;
}
