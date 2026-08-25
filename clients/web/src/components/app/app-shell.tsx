import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useMatches } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { StartFlowStateProvider } from "#/components/app/start-flow-state";
import { InboxBrowserNotificationListener } from "#/components/inbox/inbox-browser-notification-listener";
import { InboxVisibleConversationProvider } from "#/components/inbox/inbox-visible-conversation";
import { OnboardingEntryGate } from "#/components/onboarding/onboarding-entry-gate";
import { subscribeAgentReadinessInvalidations } from "#/lib/agents/agent-readiness-invalidation-bus";
import { AppOrganizationProvider } from "#/lib/organizations/organization-context";
import type { OrganizationScopeAuthorized } from "#/lib/organizations/organization-types";
import { refreshWebAgentReadinessSharedCaches } from "#/query/agents/execution-readiness";
import {
	type AppShellAccount,
	AppShellAccountContext,
} from "./app-shell-account";
import { CrossPageHeader } from "./cross-page-header";
import {
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
	type AppShellSection,
	resolveAppShellFrameClassName,
	resolveAppShellSectionFromMatches,
} from "./shell-layout";

export function AppShell(input: {
	account: AppShellAccount;
	organizationScope: OrganizationScopeAuthorized;
	storageScope: string;
}) {
	const currentSection = useMatches({
		select: resolveAppShellSectionFromMatches,
	});

	return (
		<AppShellAccountContext.Provider value={input.account}>
			<AppOrganizationProvider scope={input.organizationScope}>
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
							currentOrganization={input.organizationScope.currentOrganization}
							currentSection={currentSection}
							organizations={input.organizationScope.organizations}
							storageScope={input.storageScope}
						>
							<AppShellScaffold currentSection={currentSection} />
						</OnboardingEntryGate>
					</InboxVisibleConversationProvider>
				</StartFlowStateProvider>
			</AppOrganizationProvider>
		</AppShellAccountContext.Provider>
	);
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
		const unsubscribe = subscribeAgentReadinessInvalidations((message) => {
			for (const agentProfileId of message.agentProfileIds) {
				pendingProfileIdsRef.current.add(agentProfileId);
			}
			if (refreshTimerRef.current !== null) {
				return;
			}
			refreshTimerRef.current = window.setTimeout(flush, 500);
		});
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
