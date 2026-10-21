import { APP_PAGE_FRAME_PADDING_CLASS_NAME } from "@openmeld/ui/lib/page-frame";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useMatches } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { StartFlowStateProvider } from "#/components/app/start-flow-state";
import { InboxBrowserNotificationPrompt } from "#/components/inbox/inbox-browser-notification-prompt";
import { InboxBrowserTab } from "#/components/inbox/inbox-browser-tab";
import { InboxNotificationListener } from "#/components/inbox/inbox-notification-listener";
import { InboxVisibleConversationProvider } from "#/components/inbox/inbox-visible-conversation";
import { OnboardingEntryGate } from "#/components/onboarding/onboarding-entry-gate";
import { WalkthroughProvider } from "#/components/onboarding/walkthrough/walkthrough-context";
import { WalkthroughGuide } from "#/components/onboarding/walkthrough/walkthrough-guide";
import { AgentProfileWorkingFolderDialogHost } from "#/components/profiles/agent-profile-working-folder-recovery-action";
import { HumanPresenceProvider } from "#/components/profiles/human-presence";
import AppSettingsDialog from "#/components/settings/app-settings-dialog";
import { ConversationNamesProvider } from "#/components/spaces/conversation-names";
import { subscribeAgentReadinessInvalidations } from "#/lib/agents/agent-readiness-invalidation-bus";
import { AppOrganizationProvider } from "#/lib/organizations/organization-context";
import type { OrganizationScopeAuthorized } from "#/lib/organizations/organization-types";
import { refreshWebAgentReadinessSharedCaches } from "#/query/agents/execution-readiness";
import {
	resetAccountScopedQueriesAfterAuthChange,
	subscribeToAccountAuthChanges,
} from "#/query/auth-boundary";
import { AgentAvatarProfilesProvider } from "#/query/profiles/agent-avatar-context";
import { AccountSessionObserver } from "./account-session-observer";
import {
	type AppShellAccount,
	AppShellAccountContext,
} from "./app-shell-account";
import { CrossPageHeader } from "./cross-page-header";
import { CurrentComputerProvider } from "./current-computer";
import {
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
			const spaceId =
				params && "spaceId" in params ? params.spaceId : undefined;
			return spaceId?.startsWith("creating-") ? undefined : spaceId;
		},
	});

	return (
		<AppShellAccountContext.Provider value={input.account}>
			<AccountAuthChangeListener />
			<AccountSessionObserver />
			<AppOrganizationProvider scope={input.organizationScope}>
				<AgentAvatarProfilesProvider
					organizationId={input.organizationScope.currentOrganization.id}
					ownerAccountId={input.organizationScope.currentUserId}
				>
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
							<CurrentComputerProvider>
								<ConversationNamesProvider>
									<InboxVisibleConversationProvider>
										<AppReadinessInvalidationListener
											organizationId={
												input.organizationScope.currentOrganization.id
											}
											storageScope={input.storageScope}
										/>
										<InboxNotificationListener
											organizationId={
												input.organizationScope.currentOrganization.id
											}
											organizationSlug={
												input.organizationScope.currentOrganization.slug
											}
											userId={input.organizationScope.currentUserId}
										/>
										<WalkthroughProvider>
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
												<AgentProfileWorkingFolderDialogHost />
												<WalkthroughGuide />
											</OnboardingEntryGate>
										</WalkthroughProvider>
									</InboxVisibleConversationProvider>
								</ConversationNamesProvider>
							</CurrentComputerProvider>
						</StartFlowStateProvider>
					</HumanPresenceProvider>
				</AgentAvatarProfilesProvider>
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
	const pendingRefreshAllRef = useRef(false);
	const refreshTimerRef = useRef<number | null>(null);

	useEffect(() => {
		const flush = () => {
			refreshTimerRef.current = null;
			// No Agent Profile IDs refreshes every shared readiness projection.
			const refreshAll = pendingRefreshAllRef.current;
			const agentProfileIds = refreshAll
				? []
				: [...pendingProfileIdsRef.current];
			pendingRefreshAllRef.current = false;
			pendingProfileIdsRef.current.clear();
			refreshWebAgentReadinessSharedCaches({
				agentProfileIds,
				includeLocalRuntimeCaches: false,
				organizationId: input.organizationId,
				queryClient,
				restartInFlightReadinessReads: refreshAll,
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
				if (message.refreshAll) {
					pendingRefreshAllRef.current = true;
				}
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
			pendingRefreshAllRef.current = false;
		};
	}, [input.organizationId, input.storageScope, queryClient]);

	return null;
}

function AppShellScaffold(input: { currentSection: AppShellSection }) {
	if (input.currentSection !== "start") {
		return (
			<main className="h-dvh overflow-hidden bg-background">
				<Outlet />
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
