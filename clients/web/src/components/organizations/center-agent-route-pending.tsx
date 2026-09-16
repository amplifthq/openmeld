"use client";

import { Skeleton } from "@openmeld/ui/components/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { useSpaceComposerFiles } from "#/components/spaces/use-space-composer-attachments";
import { useCenterAgentPendingMessage } from "#/hooks/use-center-agent-pending-message";
import { useComposerDraft } from "#/hooks/use-composer-draft";
import type { CenterAgentSectionId } from "#/lib/organizations/center-agent-navigation";
import {
	centerAgentPendingAttachmentScope,
	createPendingCenterAgentMessage,
	isCenterAgentPendingMessageScopeActive,
	writeCenterAgentPendingMessage,
} from "#/lib/organizations/center-agent-pending-message";
import { findActiveDefaultHumanProfile } from "#/lib/profiles/human-profiles";
import type { SidebarPersistedState } from "#/lib/sidebar-width-cookie";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
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
	const defaultHumanProfile = findActiveDefaultHumanProfile(
		queryClient.getQueryData(
			buildStartProfilesQueryOptions({
				enabled: false,
				storageScope: input.ownerAccountId ?? "",
			}).queryKey
		) ?? []
	);
	const scope = {
		organizationSlug: input.organizationSlug,
		...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
	};
	const ownerAccountId = input.ownerAccountId?.trim() ?? "";
	const organizationId = input.organizationId?.trim() ?? "";
	const preparing = useRef(false);
	const attachments = useSpaceComposerFiles({
		organizationSlug: input.organizationSlug,
		profileId: defaultHumanProfile?.openMeldProfileId ?? "",
		spaceId: input.sessionId ?? "default",
		storageKey: centerAgentPendingAttachmentScope({
			ownerAccountId,
			organizationId,
			sessionId: input.sessionId,
		}),
		deferUpload: true,
	});
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
	const pendingMessage = useCenterAgentPendingMessage(scope);

	return (
		<CenterAgentOptimisticConversation
			attachments={ownerAccountId && organizationId ? attachments : undefined}
			composerText={pendingMessage ? "" : composerText}
			onComposerChange={setComposerText}
			onSend={async () => {
				const text = composerText.trim();
				if (
					!(text || attachments.files.length) ||
					pendingMessage ||
					preparing.current
				) {
					return;
				}
				preparing.current = true;
				try {
					const fileDrafts = attachments.files.length
						? await attachments.readFileDrafts()
						: [];
					if (!isCenterAgentPendingMessageScopeActive(queryClient, scope)) {
						return;
					}
					const nextPendingMessage = createPendingCenterAgentMessage(text);
					nextPendingMessage.files = fileDrafts.map((draft) => draft.file);
					nextPendingMessage.fileDrafts = fileDrafts;
					writeCenterAgentPendingMessage(
						queryClient,
						scope,
						nextPendingMessage
					);
				} catch (error) {
					console.error("Could not prepare chat attachments", error);
					toast.error("Couldn't prepare your attachments. Try sending again.");
				} finally {
					preparing.current = false;
				}
			}}
			organizationSlug={input.organizationSlug}
			pendingMessage={pendingMessage}
			selfProfile={defaultHumanProfile}
		/>
	);
}
