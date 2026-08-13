"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppsOnboardingDemo } from "#/components/onboarding/apps-onboarding-demo";
import { AppsOnboardingStep } from "#/components/onboarding/apps-onboarding-step";
import { ChannelsOnboardingDemo } from "#/components/onboarding/channels-onboarding-demo";
import { ChannelsOnboardingStep } from "#/components/onboarding/channels-onboarding-step";
import { prepareOnboardingDestination } from "#/components/onboarding/complete-onboarding";
import { CompleteOnboardingDemo } from "#/components/onboarding/complete-onboarding-demo";
import { useCompleteOnboardingState } from "#/components/onboarding/complete-onboarding-state";
import { CompleteOnboardingStep } from "#/components/onboarding/complete-onboarding-step";
import { InviteOnboardingDemo } from "#/components/onboarding/invite-onboarding-demo";
import { InviteOnboardingStep } from "#/components/onboarding/invite-onboarding-step";
import { LocalAgentsOnboardingDemo } from "#/components/onboarding/local-agents-onboarding-demo";
import { LocalAgentsOnboardingStep } from "#/components/onboarding/local-agents-onboarding-step";
import { OnboardingShell } from "#/components/onboarding/onboarding-shell";
import {
	OrganizationOnboardingDemo,
	type OrganizationOnboardingPerson,
	type OrganizationOnboardingPreview,
} from "#/components/onboarding/organization-onboarding-demo";
import { OrganizationOnboardingStep } from "#/components/onboarding/organization-onboarding-step";
import { SetupOnboardingDemo } from "#/components/onboarding/setup-onboarding-demo";
import { SetupOnboardingStep } from "#/components/onboarding/setup-onboarding-step";
import { useAccountAvatar } from "#/hooks/account.hooks";
import {
	advanceOnboardingProgress,
	completeOnboardingProgress,
	createInitialOnboardingProgress,
	type OpenMeldOnboardingProgress,
	type OpenMeldOnboardingStep,
	readOnboardingProgress,
	resolveNextOnboardingStep,
	resolveOnboardingReturnPath,
	resolveOnboardingStep,
	resolveOnboardingSteps,
	resolvePreviousOnboardingStep,
	restartOnboardingProgress,
	writeOnboardingProgress,
} from "#/lib/onboarding/onboarding-progress";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationOnboardingPath } from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";

const STEP_COPY: Record<
	OpenMeldOnboardingStep,
	{ description: string; eyebrow: string; title: string }
> = {
	apps: {
		description:
			"Connect the tools that hold your team’s work. You can request anything that is not ready yet.",
		eyebrow: "Apps",
		title: "Connect your team’s context",
	},
	channels: {
		description:
			"Add Slack or Lark so your team can work with OpenMeld where conversations already happen.",
		eyebrow: "Channels",
		title: "Bring OpenMeld into the conversation",
	},
	complete: {
		description: "Your setup is saved. OpenMeld keeps the work moving.",
		eyebrow: "Ready",
		title: "Your team is now AI-native",
	},
	invite: {
		description:
			"Invite teammates now, or share a link when the rest of the team is ready.",
		eyebrow: "Your team",
		title: "Bring your teammates in",
	},
	"local-agents": {
		description:
			"Connect this computer if you want OpenMeld to send work to Codex, Claude Code, Cursor, Grok Build, or OpenCode.",
		eyebrow: "This computer",
		title: "Use your local agents with OpenMeld",
	},
	organization: {
		description:
			"Use OpenMeld on your own or with a team. You can switch anytime.",
		eyebrow: "Workspace",
		title: "Choose your workspace",
	},
	setup: {
		description:
			"Review what is already enabled, then add an optional brief or information protection guidance.",
		eyebrow: "Defaults",
		title: "Built into your OpenMeld setup",
	},
};

function resolveStepCopy(input: {
	isPersonal: boolean;
	step: OpenMeldOnboardingStep;
}): { description: string; eyebrow: string; title: string } {
	if (!input.isPersonal) {
		return STEP_COPY[input.step];
	}
	if (input.step === "apps") {
		return {
			description:
				"Connect the tools that hold your work. You can request anything that is not ready yet.",
			eyebrow: "Apps",
			title: "Connect your context",
		};
	}
	if (input.step === "complete") {
		return {
			description: "Your setup is saved. Add more anytime.",
			eyebrow: "Ready",
			title: "Your personal workspace is ready",
		};
	}
	return STEP_COPY[input.step];
}

export function OnboardingPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const search = useSearch({ from: "/o/$orgSlug/onboarding" });
	const organizationContext = useAppOrganization();
	const [progress, setProgress] = useState<OpenMeldOnboardingProgress>(() => {
		if (typeof window === "undefined") {
			return createInitialOnboardingProgress();
		}
		const stored = readOnboardingProgress({
			storage: window.localStorage,
			storageScope: organizationContext.storageScope,
		});
		if (!stored) {
			return createInitialOnboardingProgress();
		}
		if (stored.completedAtMs !== null || search.restart === "1") {
			return restartOnboardingProgress({
				current: stored,
			});
		}
		return stored;
	});
	const [previewOrganization, setPreviewOrganization] =
		useState<OrganizationOnboardingPreview>(() => ({
			id: organizationContext.currentOrganization.id,
			isPersonal: organizationContext.currentOrganization.isPersonal === true,
			logo: organizationContext.currentOrganization.logo,
			name: organizationContext.currentOrganization.name,
		}));
	const [pendingOrganization, setPendingOrganization] =
		useState<OrganizationSummary | null>(null);
	const onboardingOrganization =
		pendingOrganization ?? organizationContext.currentOrganization;
	const isPersonalWorkspace = onboardingOrganization.isPersonal === true;
	const onboardingSteps = resolveOnboardingSteps({
		isPersonal: isPersonalWorkspace,
	});
	const currentStep = resolveOnboardingStep({
		currentStep: progress.currentStep,
		isPersonal: isPersonalWorkspace,
	});
	const copy = resolveStepCopy({
		isPersonal: isPersonalWorkspace,
		step: currentStep,
	});
	const directoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			enabled: currentStep === "organization" && !isPersonalWorkspace,
			organizationId: organizationContext.currentOrganization.id,
		})
	);
	const { data: currentAccountAvatar } = useAccountAvatar();
	const currentUser = useMemo<OrganizationOnboardingPerson | null>(() => {
		const name = organizationContext.account.name?.trim();
		if (!name) {
			return null;
		}
		return {
			id: organizationContext.currentUserId,
			image: currentAccountAvatar?.avatar ?? null,
			name,
		};
	}, [
		organizationContext.account.name,
		organizationContext.currentUserId,
		currentAccountAvatar?.avatar,
	]);
	const currentOrganizationPeople = useMemo<
		OrganizationOnboardingPerson[]
	>(() => {
		if (isPersonalWorkspace) {
			return currentUser ? [currentUser] : [];
		}
		const members = directoryQuery.data?.members;
		if (!members || members.length === 0) {
			return currentUser ? [currentUser] : [];
		}
		return [...members]
			.sort((left, right) => {
				if (left.userId === organizationContext.currentUserId) {
					return -1;
				}
				if (right.userId === organizationContext.currentUserId) {
					return 1;
				}
				return left.user.name.localeCompare(right.user.name);
			})
			.slice(0, 3)
			.map((member) => ({
				id: member.userId,
				image: member.user.image,
				name: member.user.name,
			}));
	}, [
		currentUser,
		directoryQuery.data?.members,
		isPersonalWorkspace,
		organizationContext.currentUserId,
	]);
	const currentUserPreviewPeople = currentUser ? [currentUser] : [];
	const previewPeople =
		previewOrganization.id === organizationContext.currentOrganization.id
			? currentOrganizationPeople
			: currentUserPreviewPeople;
	const completeState = useCompleteOnboardingState({
		enabled: currentStep === "complete",
	});

	useEffect(() => {
		setPreviewOrganization({
			id: organizationContext.currentOrganization.id,
			isPersonal: organizationContext.currentOrganization.isPersonal === true,
			logo: organizationContext.currentOrganization.logo,
			name: organizationContext.currentOrganization.name,
		});
	}, [organizationContext.currentOrganization]);

	useEffect(() => {
		if (
			pendingOrganization?.id === organizationContext.currentOrganization.id
		) {
			setPendingOrganization(null);
		}
	}, [organizationContext.currentOrganization.id, pendingOrganization]);

	useEffect(() => {
		if (currentStep !== "organization" || progress.completedAtMs !== null) {
			return;
		}
		if (pendingOrganization) {
			return;
		}
		const normalizedProgress =
			progress.currentStep === currentStep
				? progress
				: advanceOnboardingProgress({
						current: progress,
						step: currentStep,
					});
		if (normalizedProgress !== progress) {
			setProgress(normalizedProgress);
		}
		writeOnboardingProgress({
			progress: normalizedProgress,
			storage: window.localStorage,
			storageScope: organizationContext.storageScope,
		});
	}, [
		currentStep,
		organizationContext.storageScope,
		pendingOrganization,
		progress,
	]);

	const persistProgress = (next: OpenMeldOnboardingProgress) => {
		setProgress(next);
		writeOnboardingProgress({
			progress: next,
			storage: window.localStorage,
			storageScope: organizationContext.storageScope,
		});
	};
	const goToStep = (step: OpenMeldOnboardingStep) => {
		persistProgress(
			advanceOnboardingProgress({
				current: progress,
				step,
			})
		);
	};
	const goToNextStep = () => {
		goToStep(
			resolveNextOnboardingStep({
				currentStep,
				isPersonal: isPersonalWorkspace,
			})
		);
	};
	const handleOrganizationChosen = async (
		organization: OrganizationSummary
	) => {
		const next = advanceOnboardingProgress({
			current: progress,
			selectedOrganizationId: organization.id,
			step: resolveNextOnboardingStep({
				currentStep: "organization",
				isPersonal: organization.isPersonal === true,
			}),
		});
		const switchesOrganization =
			organization.slug !== organizationContext.currentOrganization.slug;
		if (switchesOrganization) {
			setPendingOrganization(organization);
		}
		persistProgress(next);
		if (switchesOrganization) {
			try {
				await navigate({
					to: buildOrganizationOnboardingPath(organization.slug),
				});
			} catch (error) {
				setPendingOrganization(null);
				persistProgress(progress);
				throw error;
			}
		}
	};
	const finishAndEnterOpenMeld = async () => {
		const organizationId = completeState.organizationId;
		await prepareOnboardingDestination({ organizationId, queryClient });
		const completed = completeOnboardingProgress({ current: progress });
		persistProgress(completed);
		await navigate({
			replace: true,
			to: resolveOnboardingReturnPath({
				currentOrganizationSlug: organizationContext.currentOrganization.slug,
				progress: completed,
			}),
		});
	};
	let stepContent = (
		<OrganizationOnboardingStep
			currentOrganization={organizationContext.currentOrganization}
			currentUserId={organizationContext.currentUserId}
			onOrganizationChosen={handleOrganizationChosen}
			onPreviewOrganizationChange={setPreviewOrganization}
			organizations={organizationContext.organizations}
		/>
	);
	if (currentStep === "organization") {
		stepContent = (
			<OrganizationOnboardingStep
				currentOrganization={organizationContext.currentOrganization}
				currentUserId={organizationContext.currentUserId}
				onOrganizationChosen={handleOrganizationChosen}
				onPreviewOrganizationChange={setPreviewOrganization}
				organizations={organizationContext.organizations}
			/>
		);
	} else if (currentStep === "apps") {
		stepContent = <AppsOnboardingStep onContinue={goToNextStep} />;
	} else if (currentStep === "channels") {
		stepContent = <ChannelsOnboardingStep onContinue={goToNextStep} />;
	} else if (currentStep === "local-agents") {
		stepContent = <LocalAgentsOnboardingStep onContinue={goToNextStep} />;
	} else if (currentStep === "setup") {
		stepContent = <SetupOnboardingStep onContinue={goToNextStep} />;
	} else if (currentStep === "invite") {
		stepContent = <InviteOnboardingStep onContinue={goToNextStep} />;
	} else if (currentStep === "complete") {
		stepContent = (
			<CompleteOnboardingStep
				onContinue={finishAndEnterOpenMeld}
				state={completeState}
			/>
		);
	}
	let demo = (
		<OrganizationOnboardingDemo
			organization={previewOrganization}
			people={previewPeople}
		/>
	);
	if (currentStep === "channels") {
		demo = <ChannelsOnboardingDemo />;
	} else if (currentStep === "apps") {
		demo = <AppsOnboardingDemo />;
	} else if (currentStep === "local-agents") {
		demo = <LocalAgentsOnboardingDemo />;
	} else if (currentStep === "setup") {
		demo = <SetupOnboardingDemo />;
	} else if (currentStep === "invite") {
		demo = <InviteOnboardingDemo />;
	} else if (currentStep === "complete") {
		demo = <CompleteOnboardingDemo state={completeState} />;
	}

	return (
		<OnboardingShell
			demo={demo}
			description={copy.description}
			eyebrow={copy.eyebrow}
			onBack={
				currentStep === "organization"
					? undefined
					: () =>
							goToStep(
								resolvePreviousOnboardingStep({
									currentStep,
									isPersonal: isPersonalWorkspace,
								})
							)
			}
			onSkip={
				currentStep === "complete"
					? undefined
					: () => {
							finishAndEnterOpenMeld().catch((error: unknown) => {
								console.error("OpenMeld could not leave onboarding.", {
									error,
								});
							});
						}
			}
			step={currentStep}
			steps={onboardingSteps}
			title={copy.title}
		>
			{stepContent}
		</OnboardingShell>
	);
}
