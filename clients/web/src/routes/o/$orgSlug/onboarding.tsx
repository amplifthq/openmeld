import { OpenMeldLoadingScreen } from "@openmeld/ui/components/openmeld-loading-screen";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { appShellStaticData } from "#/components/app/shell-layout";

const WalkthroughEntry = lazy(() =>
	import("#/components/onboarding/walkthrough/walkthrough-entry").then(
		(module) => ({ default: module.WalkthroughEntry })
	)
);

type OnboardingSearch = {
	restart?: "1";
	experience?: "first-work";
	workspace?: "1";
};

export const Route = createFileRoute("/o/$orgSlug/onboarding")({
	component: OnboardingRoute,
	validateSearch: (search): OnboardingSearch => ({
		restart: search.restart === "1" || search.restart === 1 ? "1" : undefined,
		experience: search.experience === "first-work" ? "first-work" : undefined,
		workspace:
			search.workspace === "1" || search.workspace === 1 ? "1" : undefined,
	}),
	ssr: false,
	staticData: appShellStaticData.onboarding,
});

function OnboardingRoute() {
	return (
		<Suspense fallback={<OpenMeldLoadingScreen className="h-dvh" />}>
			<WalkthroughEntry />
		</Suspense>
	);
}
