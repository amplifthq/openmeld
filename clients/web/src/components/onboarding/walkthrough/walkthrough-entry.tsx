import { Button } from "@openmeld/ui/components/button";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { OrganizationOnboardingStep } from "#/components/onboarding/organization-onboarding-step";
import { useWalkthrough } from "#/components/onboarding/walkthrough/walkthrough-context";
import { useAppOrganization } from "#/lib/organizations/organization-context";

export function WalkthroughEntry() {
	const context = useAppOrganization();
	const guide = useWalkthrough();
	const navigate = useNavigate();
	const search = useSearch({ from: "/o/$orgSlug/onboarding" });
	const starting = useRef(false);
	useEffect(() => {
		if (search.workspace !== "1" || !guide?.available || starting.current) {
			return;
		}
		starting.current = true;
		guide.start().catch(() => undefined);
	}, [guide, search.workspace]);
	return (
		<main className="flex h-dvh w-full overflow-y-auto px-6 py-8">
			<div className="m-auto flex w-full max-w-xl flex-col">
				<h1 className="font-semibold text-2xl">Welcome to OpenMeld</h1>
				<p className="mt-2 mb-6 text-muted-foreground text-sm">
					{search.workspace === "1"
						? "Opening tutorial…"
						: "Choose a workspace to create your first Space and meet your agent."}
				</p>
				{guide?.loading ? <output>Loading tutorial…</output> : null}
				{guide?.error ? (
					<p className="mb-4 text-destructive text-sm" role="alert">
						{guide.error.message}
					</p>
				) : null}
				{guide?.available && search.workspace !== "1" ? (
					<OrganizationOnboardingStep
						currentOrganization={context.currentOrganization}
						currentUserId={context.currentUserId}
						onOrganizationChosen={async (chosen) => {
							await navigate({
								to: "/o/$orgSlug/onboarding",
								params: { orgSlug: chosen.slug },
								search: {
									workspace: "1",
								},
							});
						}}
						organizations={context.organizations}
					/>
				) : null}
				{guide?.error ? (
					<Button
						onClick={() =>
							(guide.available && search.workspace === "1"
								? guide.start()
								: guide.retry()
							).catch(() => undefined)
						}
					>
						Try again
					</Button>
				) : null}
			</div>
		</main>
	);
}
