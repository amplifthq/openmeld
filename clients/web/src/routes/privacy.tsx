import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPolicyPage } from "#/components/legal/privacy-policy-page";
import { buildPublicPageHead } from "#/lib/site";

const PRIVACY_DESCRIPTION =
	"How OpenMeld handles account, Space, connected-computer, agent, diagnostic, and support information for its experimental collaboration service.";

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
