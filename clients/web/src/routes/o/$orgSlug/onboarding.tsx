import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { OnboardingPage } from "#/components/onboarding/onboarding-page";

type OnboardingSearch = {
	restart?: "1";
};

export const Route = createFileRoute("/o/$orgSlug/onboarding")({
	component: OnboardingPage,
	validateSearch: (search): OnboardingSearch => ({
		restart: search.restart === "1" ? "1" : undefined,
	}),
	ssr: false,
	staticData: appShellStaticData.onboarding,
});
