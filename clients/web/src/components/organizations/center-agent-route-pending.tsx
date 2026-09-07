"use client";

import { Skeleton } from "@openmeld/ui/components/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useComposerDraft } from "#/hooks/use-composer-draft";
import type { CenterAgentSectionId } from "#/lib/organizations/center-agent-navigation";
import {
	activateCenterAgentPendingMessageScope,
	createPendingCenterAgentMessage,
	type PendingCenterAgentMessage,
	readCenterAgentPendingMessage,
	writeCenterAgentPendingMessage,
} from "#/lib/organizations/center-agent-pending-message";
import type { SidebarPersistedState } from "#/lib/sidebar-width-cookie";
import { CenterAgentPendingLayout } from "./center-agent-layout";
import { CenterAgentOptimisticConversation } from "./center-agent-optimistic-conversation";

export function CenterAgentRoutePendingPage(input: {
	sessionId?: string;
	initialOuterSidebarState?: SidebarPersistedState;
	ownerAccountId?: string;
	organizationId?: string;
	organizationSlug: string;
	section: CenterAgentSectionId;
}) {
	return (
		<CenterAgentPendingLayout
			initialOuterSidebarState={input.initialOuterSidebarState}
		>
			{input.section === "chat" ? (
				<CenterAgentPendingConversation
					key={input.sessionId ?? "default"}
					organizationId={input.organizationId}
					organizationSlug={input.organizationSlug}
					ownerAccountId={input.ownerAccountId}
					sessionId={input.sessionId}
				/>
			) : (
				<CenterAgentPendingSection />
			)}
		</CenterAgentPendingLayout>
	);
}

function CenterAgentPendingSection() {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="h-[var(--space-conversation-header-height)] shrink-0 border-b" />
			<div className="mx-auto grid w-full max-w-6xl gap-4 p-6">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-24 w-full" />
			</div>
		</div>
	);
}

export function CenterAgentPendingConversation(input: {
	sessionId?: string;
	ownerAccountId?: string;
	organizationId?: string;
	organizationSlug: string;
}) {
	const queryClient = useQueryClient();
	const scope = {
		organizationSlug: input.organizationSlug,
		...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
	};
	const ownerAccountId = input.ownerAccountId?.trim() ?? "";
	const organizationId = input.organizationId?.trim() ?? "";
	const composerDraft = useComposerDraft({
		scope:
			ownerAccountId && organizationId
				? {
						kind: "center_agent_pending",
						...(input.sessionId === undefined
							? {}
							: { sessionId: input.sessionId }),
						organizationId,
						ownerAccountId,
					}
				: null,
	});
	const composerText = composerDraft.content.text;
	const setComposerText = (text: string) => {
		composerDraft.setContent((currentDraft) => ({
			...currentDraft,
			text,
		}));
	};
	const [pendingMessage, setPendingMessage] =
		useState<PendingCenterAgentMessage | null>(() => {
			activateCenterAgentPendingMessageScope(queryClient, scope);
			return readCenterAgentPendingMessage(queryClient, scope);
		});

	return (
		<CenterAgentOptimisticConversation
			composerText={pendingMessage ? "" : composerText}
			onComposerChange={setComposerText}
			onSend={() => {
				const text = composerText.trim();
				if (!text || pendingMessage) {
					return;
				}
				const nextPendingMessage = createPendingCenterAgentMessage(text);
				writeCenterAgentPendingMessage(queryClient, scope, nextPendingMessage);
				setPendingMessage(nextPendingMessage);
			}}
			pendingMessage={pendingMessage}
		/>
	);
}
