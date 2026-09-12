import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useMatches } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { StartFlowStateProvider } from "#/components/app/start-flow-state";
import { InboxBrowserNotificationListener } from "#/components/inbox/inbox-browser-notification-listener";
import { InboxBrowserNotificationPrompt } from "#/components/inbox/inbox-browser-notification-prompt";
import { InboxBrowserTab } from "#/components/inbox/inbox-browser-tab";
import { InboxVisibleConversationProvider } from "#/components/inbox/inbox-visible-conversation";
import { OnboardingEntryGate } from "#/components/onboarding/onboarding-entry-gate";
import { HumanPresenceProvider } from "#/components/profiles/human-presence";
import AppSettingsDialog from "#/components/settings/app-settings-dialog";
import { subscribeAgentReadinessInvalidations } from "#/lib/agents/agent-readiness-invalidation-bus";
import { AppOrganizationProvider } from "#/lib/organizations/organization-context";
import type { OrganizationScopeAuthorized } from "#/lib/organizations/organization-types";
import { refreshWebAgentReadinessSharedCaches } from "#/query/agents/execution-readiness";
import {
	resetAccountScopedQueriesAfterAuthChange,
	subscribeToAccountAuthChanges,
} from "#/query/auth-boundary";
import {
	type AppShellAccount,
	AppShellAccountContext,
} from "./app-shell-account";
import { CrossPageHeader } from "./cross-page-header";
import { CurrentComputerProvider } from "./current-computer";
import {
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
	type AppShellSection,
	resolveAppShellFrameClassName,
	resolveAppShellSectionFromMatches,
} from "./shell-layout";
import { WebMemberActivityReporter } from "./web-member-activity-reporter";

export function AppShell(input: {
	account: AppShellAccount;
	organizationScope: OrganizationScopeAuthorized;
	storageScope: string;
}) {
	const currentSection = useMatches({
		select: resolveAppShellSectionFromMatches,
	});
	const activeSpaceId = useMatches({
		select: (matches) => {
			const params = matches.findLast(
				(match) => "spaceId" in match.params
			)?.params;
			return params && "spaceId" in params ? params.spaceId : undefined;
		},
	});

	return (
		<AppShellAccountContext.Provider value={input.account}>
			<AccountAuthChangeListener />
			<AppOrganizationProvider scope={input.organizationScope}>
				<InboxBrowserTab
					key={`${input.storageScope}:${input.organizationScope.currentOrganization.id}`}
					organizationId={input.organizationScope.currentOrganization.id}
				/>
				<HumanPresenceProvider>
					<WebMemberActivityReporter
						currentUserId={input.organizationScope.currentUserId}
						organizationId={input.organizationScope.currentOrganization.id}
						spaceId={activeSpaceId}
					/>
					<StartFlowStateProvider storageScope={input.storageScope}>
						<InboxVisibleConversationProvider>
							<AppReadinessInvalidationListener
								organizationId={input.organizationScope.currentOrganization.id}
								storageScope={input.storageScope}
							/>
							<InboxBrowserNotificationListener
								organizationId={input.organizationScope.currentOrganization.id}
								organizationSlug={
									input.organizationScope.currentOrganization.slug
								}
								userId={input.organizationScope.currentUserId}
							/>
							<OnboardingEntryGate
								currentOrganization={
									input.organizationScope.currentOrganization
								}
								currentSection={currentSection}
								hasExplicitSpaceDestination={Boolean(activeSpaceId)}
								organizations={input.organizationScope.organizations}
								storageScope={input.storageScope}
							>
								{currentSection === "space" && activeSpaceId ? (
									<InboxBrowserNotificationPrompt
										userId={input.organizationScope.currentUserId}
									/>
								) : null}
								<AppShellScaffold currentSection={currentSection} />
								<AppSettingsDialog />
							</OnboardingEntryGate>
						</InboxVisibleConversationProvider>
					</StartFlowStateProvider>
				</HumanPresenceProvider>
			</AppOrganizationProvider>
		</AppShellAccountContext.Provider>
	);
}

function AccountAuthChangeListener() {
	const queryClient = useQueryClient();
	const reloadingRef = useRef(false);

	useEffect(() => {
		return subscribeToAccountAuthChanges(() => {
			if (reloadingRef.current) {
				return;
			}
			reloadingRef.current = true;
			resetAccountScopedQueriesAfterAuthChange(queryClient).finally(() => {
				window.location.assign("/");
			});
		});
	}, [queryClient]);

	return null;
}

function AppReadinessInvalidationListener(input: {
	organizationId: string;
	storageScope: string;
}) {
	const queryClient = useQueryClient();
	const pendingProfileIdsRef = useRef(new Set<string>());
	const refreshTimerRef = useRef<number | null>(null);

	useEffect(() => {
		const flush = () => {
			refreshTimerRef.current = null;
			const agentProfileIds = [...pendingProfileIdsRef.current];
			pendingProfileIdsRef.current.clear();
			refreshWebAgentReadinessSharedCaches({
				agentProfileIds,
				includeLocalRuntimeCaches: false,
				organizationId: input.organizationId,
				queryClient,
				storageScope: input.storageScope,
			}).catch((error: unknown) => {
				console.warn("[openmeld.web.agent_readiness_invalidation_bus_failed]", {
					agentProfileIds,
					error: error instanceof Error ? error.message : String(error),
					storageScope: input.storageScope,
				});
			});
		};
		const unsubscribe = subscribeAgentReadinessInvalidations(
			(message) => {
				for (const agentProfileId of message.agentProfileIds) {
					pendingProfileIdsRef.current.add(agentProfileId);
				}
				if (refreshTimerRef.current !== null) {
					return;
				}
				refreshTimerRef.current = window.setTimeout(flush, 500);
			},
			{ organizationId: input.organizationId, storageScope: input.storageScope }
		);
		return () => {
			unsubscribe();
			if (refreshTimerRef.current !== null) {
				window.clearTimeout(refreshTimerRef.current);
				refreshTimerRef.current = null;
			}
			pendingProfileIdsRef.current.clear();
		};
	}, [input.organizationId, input.storageScope, queryClient]);

	return null;
}

function AppShellScaffold(input: { currentSection: AppShellSection }) {
	if (input.currentSection !== "start") {
		return (
			<main className="h-dvh overflow-hidden bg-background">
				<CurrentComputerProvider>
					<Outlet />
				</CurrentComputerProvider>
			</main>
		);
	}

	return (
		<main className="min-h-screen bg-background">
			<CrossPageHeader currentSection={input.currentSection} />

			<div
				className={`mx-auto flex w-full flex-col gap-4 py-6 ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${resolveAppShellFrameClassName(
					input.currentSection
				)}`}
			>
				<Outlet />
			</div>
		</main>
	);
}
