import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { resolveDirectoryHumanProfileActivityLabel } from "#/components/directory/directory-human-profile-format";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationDirectMessagePath,
} from "#/lib/organizations/organization-routes";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { SidebarSearchInput } from "../app/sidebar-search-input";
import { SpaceProfileIcon } from "./space-profile-icon";

export function NewDirectMessageDialog(input: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>New chat</DialogTitle>
				</DialogHeader>
				<DirectMessagePicker
					enabled={input.open}
					onDone={() => input.onOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}

export function DirectMessagePicker(input: {
	enabled: boolean;
	includeSelf?: boolean;
	onDone?: () => void;
	onOpenChat?: (chat: {
		spaceId: string;
		profileId: string;
		title: string;
	}) => void;
	onOpenCenterAgent?: () => void;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const [search, setSearch] = useState("");
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			organizationId: currentOrganization.id,
			enabled: input.enabled,
		})
	);
	const navigate = useNavigate();
	const client = useQueryClient();
	const chat = useMutation({
		mutationFn: (targetProfileId: string) =>
			openCurrentDirectMessageSpace({
				organizationId: currentOrganization.id,
				targetProfileId,
			}),
		onError: (error) =>
			toast.error(resolveDirectMessageOpenErrorMessage(error)),
		onSuccess: async (response, targetProfileId) => {
			await client.invalidateQueries({
				queryKey: accountSpaceQueryKeys.all,
				refetchType: "none",
			});
			if (input.onOpenChat) {
				input.onOpenChat({
					spaceId: response.spaceId,
					profileId: response.memberProfileId,
					title:
						directory.data?.agentProfiles.find(
							(p) => p.profileId === targetProfileId
						)?.profileName ??
						directory.data?.members.find(
							(m) => m.humanProfile?.profileId === targetProfileId
						)?.humanProfile?.profileName ??
						"Chat",
				});
			} else {
				await navigate({
					to: buildOrganizationDirectMessagePath({
						orgSlug: currentOrganization.slug,
						spaceId: response.spaceId,
						search: { profileId: response.memberProfileId },
					}),
				});
			}
			input.onDone?.();
			setSearch("");
		},
	});
	const people = (directory.data?.members ?? []).flatMap((m) =>
		(input.includeSelf || m.user.id !== currentUserId) &&
		m.humanProfile?.status === "active"
			? [
					{
						id: m.humanProfile.profileId,
						name: m.humanProfile.profileName,
						kind: "human" as const,
						avatar: m.user.image,
						controller: null,
						owner:
							m.user.id === currentUserId
								? "You"
								: (resolveDirectoryHumanProfileActivityLabel({
										lastActiveAt: m.lastActiveAt ?? null,
										profileStatus: m.humanProfile.status,
									}) ?? ""),
						isSelf: m.user.id === currentUserId,
					},
				]
			: []
	);
	const agents = (directory.data?.agentProfiles ?? [])
		.filter(
			(p) =>
				p.status === "active" &&
				!p.isCenterAgent &&
				p.managedRole !== "center_agent"
		)
		.map((p) => ({
			id: p.profileId,
			name: p.profileName,
			kind: "agent" as const,
			isSelf: false,
			avatar: p.avatarUrl,
			controller: p.agentControllerRef,
			owner:
				directory.data?.members.find((m) => m.userId === p.ownerUserId)
					?.humanProfile?.profileName ?? "",
		}));
	return (
		<div className="flex min-h-0 flex-col gap-3">
			<Button
				onClick={() => {
					input.onDone?.();
					if (input.onOpenCenterAgent) {
						input.onOpenCenterAgent();
						return;
					}
					navigate({
						to: buildOrganizationCenterAgentChatPath(currentOrganization.slug, {
							draft: "new",
						}),
					});
				}}
				variant="outline"
			>
				Center Agent
			</Button>
			<SidebarSearchInput
				label="Search People or Agents"
				onValueChange={setSearch}
				value={search}
			/>
			<ScrollArea className="max-h-80">
				{directory.isPending && (
					<p className="p-2 text-muted-foreground text-sm">
						Loading People and Agents…
					</p>
				)}
				{directory.isError && (
					<Button onClick={() => directory.refetch()} variant="outline">
						Retry
					</Button>
				)}
				{!(directory.isPending || directory.isError) && (
					<>
						{[
							{ label: "People", items: people },
							{ label: "Agents", items: agents },
						].map((group) => {
							const items = group.items.filter((p) =>
								`${p.name} ${p.owner}`
									.toLowerCase()
									.includes(search.trim().toLowerCase())
							);
							return items.length ? (
								<div className="mb-3" key={group.label}>
									<p className="px-2 py-2 text-muted-foreground text-xs">
										{group.label}
									</p>
									{items.map((p) => (
										<Button
											className="w-full justify-start gap-2"
											disabled={chat.isPending || p.isSelf}
											key={p.id}
											onClick={() => chat.mutate(p.id)}
											variant="ghost"
										>
											<SpaceProfileIcon
												agentControllerRef={p.controller}
												avatarImageUrl={
													p.kind === "human" ? p.avatar : undefined
												}
												profileId={p.id}
												profileKind={p.kind}
												profileName={p.name}
												size="sm"
											/>
											<span className="min-w-0 flex-1 truncate text-left">
												{p.name}
											</span>
											{p.owner && (
												<span className="max-w-28 truncate text-muted-foreground text-xs">
													{p.owner}
												</span>
											)}
										</Button>
									))}
								</div>
							) : null;
						})}
						{![...people, ...agents].some((p) =>
							`${p.name} ${p.owner}`
								.toLowerCase()
								.includes(search.trim().toLowerCase())
						) && (
							<p className="p-2 text-muted-foreground text-sm">
								No matching People or Agents.
							</p>
						)}
					</>
				)}
			</ScrollArea>
		</div>
	);
}
