"use client";

import { OpenMeldLoadingScreen } from "@openmeld/ui/components/openmeld-loading-screen";
import { useNavigate } from "@tanstack/react-router";
import type { PropsWithChildren } from "react";
import { useEffect, useRef, useState } from "react";
import type { AppShellSection } from "#/components/app/shell-layout";
import { buildOrganizationOnboardingPath } from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { useWalkthrough } from "./walkthrough/walkthrough-context";

type EntryState = "checking" | "ready" | "redirecting";

export function OnboardingEntryGate(
	input: PropsWithChildren<{
		currentOrganization: OrganizationSummary;
		currentSection: AppShellSection;
		hasExplicitSpaceDestination?: boolean;
		organizations: readonly OrganizationSummary[];
		storageScope: string;
	}>
) {
	const navigate = useNavigate();
	const walkthrough = useWalkthrough();
	const hasWalkthrough = walkthrough?.hasStartedTutorial === true;
	const walkthroughLoading = walkthrough?.loading === true;
	const [entryState, setEntryState] = useState<EntryState>("checking");
	const spaceJourneyScope = useRef<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		if (hasWalkthrough) {
			setEntryState("ready");
			return;
		}
		// A requested Space is already a concrete task. Keep its access gate and
		// in-Space guidance; do not replace an invitation with the tutorial.
		if (input.hasExplicitSpaceDestination) {
			spaceJourneyScope.current = input.storageScope;
		}
		if (input.currentSection === "onboarding") {
			spaceJourneyScope.current = null;
		}
		if (spaceJourneyScope.current === input.storageScope) {
			setEntryState("ready");
			return;
		}
		if (input.currentSection === "onboarding") {
			setEntryState("ready");
			return;
		}
		if (walkthroughLoading) {
			setEntryState("checking");
			return;
		}
		// A progress-service failure must not lock the user out of the product.
		// The explicit tutorial entry owns its error and retry action.
		if (walkthrough?.error) {
			setEntryState("ready");
			return;
		}
		setEntryState("redirecting");
		Promise.resolve(
			navigate({
				replace: true,
				to: buildOrganizationOnboardingPath(input.currentOrganization.slug),
			})
		).catch((error: unknown) => {
			if (cancelled) {
				return;
			}
			console.error("OpenMeld could not open onboarding.", {
				error,
				storageScope: input.storageScope,
			});
			setEntryState("ready");
		});
		return () => {
			cancelled = true;
		};
	}, [
		hasWalkthrough,
		walkthroughLoading,
		walkthrough?.error,
		input.currentOrganization,
		input.currentSection,
		input.hasExplicitSpaceDestination,
		input.storageScope,
		navigate,
	]);

	if (entryState !== "ready") {
		return <OpenMeldLoadingScreen className="h-dvh" />;
	}
	return input.children;
}
