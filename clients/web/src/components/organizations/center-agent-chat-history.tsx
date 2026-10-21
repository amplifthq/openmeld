import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
import { useDirectMessageSessionActions } from "#/components/member-agents/direct-message-session-actions";
import { ChatHistoryDropdown } from "#/components/spaces/chat-history-dropdown";
import { resolveConversationTitle } from "#/lib/conversations/presentation";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationCenterAgentChatPath } from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { centerAgentSessionsQueryOptions } from "#/query/organizations/center-agent-sessions";

export function CenterAgentChatHistory({
	title,
	spaceId,
	disabled = false,
	titleAction,
}: {
	title: string;
	spaceId?: string;
	disabled?: boolean;
	titleAction?: ReactNode;
}) {
	const { currentOrganization: organization } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const profileId = defaultHumanProfile?.openMeldProfileId ?? "";
	const preferences = useSidebarPreferences(organization.id);
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	// MemberAgent program: Center Agent sessions gain Delete chat; rename and
	// archive stay the existing personal title editor and chat-menu archive.
	const sessionActions = useDirectMessageSessionActions({
		spaceId: spaceId ?? "",
		onLeave: () =>
			navigate({
				to: buildOrganizationCenterAgentChatPath(organization.slug, {
					draft: "new",
				}),
			}),
		enabled: Boolean(spaceId) && isMemberAgentsEnabled(),
		extraRefresh: () =>
			queryClient.invalidateQueries({
				queryKey: ["center-agent", organization.id],
			}),
	});
	const sessions = useInfiniteQuery({
		...centerAgentSessionsQueryOptions(organization.id, profileId),
		enabled: open && !!profileId,
	});
	// Search includes every authorized page, including personally archived chats.
	useEffect(() => {
		if (
			open &&
			sessions.hasNextPage &&
			!sessions.isFetching &&
			!sessions.isError
		) {
			sessions.fetchNextPage();
		}
	}, [
		open,
		sessions.hasNextPage,
		sessions.isFetching,
		sessions.isError,
		sessions.fetchNextPage,
	]);
	const chats = (
		sessions.data?.pages.flatMap((page) => page.sessions) ?? []
	).map((session) => ({
		spaceId: session.spaceId,
		createdAt: session.createdAt,
		title: resolveConversationTitle(
			session.spaceId,
			session.name,
			preferences.preferences?.chats?.titles
		),
	}));
	return (
		<>
			<ChatHistoryDropdown
				ariaLabel={`Open chat history: ${title}`}
				currentSpaceId={spaceId}
				disabled={disabled}
				groups={[
					{
						id: "center-agent",
						label: "Chat history",
						items: chats,
						isLoading: !sessions.isError && sessions.isFetching,
						isError: sessions.isError,
						onRetry: () => {
							(sessions.hasNextPage
								? sessions.fetchNextPage()
								: sessions.refetch()
							).catch(console.error);
						},
					},
				]}
				onNewChat={
					spaceId
						? () => {
								navigate({
									to: buildOrganizationCenterAgentChatPath(organization.slug, {
										draft: "new",
									}),
								});
							}
						: undefined
				}
				onOpenChange={setOpen}
				onSelect={(session) => {
					navigate({
						to: buildOrganizationCenterAgentChatPath(organization.slug, {
							session,
						}),
					});
				}}
				renderTrailingItems={sessionActions.renderMenuItems}
				title={title}
				titleAction={titleAction}
			/>
			{sessionActions.dialogs}
		</>
	);
}
