"use client";

import { useNavigate } from "@tanstack/react-router";
import type { PropsWithChildren } from "react";
import { useEffect, useState } from "react";
import type { AppShellSection } from "#/components/app/shell-layout";
import { OpenMeldLogo } from "#/components/openmeld-logo-weak";
import {
	createInitialOnboardingProgress,
	readOnboardingProgress,
	resolveOnboardingResumeTarget,
	writeOnboardingProgress,
} from "#/lib/onboarding/onboarding-progress";
import { buildOrganizationOnboardingPath } from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";

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
	const [entryState, setEntryState] = useState<EntryState>("checking");

	useEffect(() => {
		let cancelled = false;
		// A requested Space is already a concrete task. Keep its access gate and
		// in-Space setup guidance; do not replace the destination with Studio.
		if (input.hasExplicitSpaceDestination) {
			setEntryState("ready");
			return;
		}
		const existing = readOnboardingProgress({
			storage: window.localStorage,
			storageScope: input.storageScope,
		});
		if (existing?.completedAtMs && input.currentSection !== "onboarding") {
			setEntryState("ready");
			return;
		}
		if (!existing && input.currentSection === "onboarding") {
			setEntryState("ready");
			return;
		}
		const progress =
			existing ??
			createInitialOnboardingProgress({
				returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
			});
		const resumeTarget = resolveOnboardingResumeTarget({
			currentOrganization: input.currentOrganization,
			organizations: input.organizations,
			progress,
		});
		writeOnboardingProgress({
			progress: resumeTarget.progress,
			storage: window.localStorage,
			storageScope: input.storageScope,
		});
		if (
			input.currentSection === "onboarding" &&
			resumeTarget.organization.id === input.currentOrganization.id
		) {
			setEntryState("ready");
			return;
		}
		setEntryState("redirecting");
		Promise.resolve(
			navigate({
				replace: true,
				to: buildOrganizationOnboardingPath(resumeTarget.organization.slug),
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
		input.currentOrganization,
		input.currentSection,
		input.hasExplicitSpaceDestination,
		input.organizations,
		input.storageScope,
		navigate,
	]);

	if (entryState !== "ready") {
		return <OnboardingRedirectSurface />;
	}
	return input.children;
}

function OnboardingRedirectSurface() {
	return (
		<main
			aria-busy="true"
			aria-label="Opening OpenMeld setup"
			className="grid h-dvh place-items-center overflow-hidden bg-background"
		>
			<div className="flex flex-col items-center gap-5 text-muted-foreground">
				<OpenMeldLogo
					ariaLabel="OpenMeld"
					className="text-foreground"
					pointerTracking="element"
					scale={0.18}
				/>
				<span className="h-px w-12 animate-pulse bg-border" />
			</div>
		</main>
	);
}
