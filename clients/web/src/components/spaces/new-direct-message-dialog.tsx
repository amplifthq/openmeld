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
	groupId?: string;
	onCreated?: (spaceId: string) => void | Promise<void>;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const [search, setSearch] = useState("");
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			organizationId: currentOrganization.id,
			enabled: input.open,
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
		onSuccess: async (response) => {
			await input.onCreated?.(response.spaceId);
			await client.invalidateQueries({
				queryKey: accountSpaceQueryKeys.all,
				refetchType: "none",
			});
			await navigate({
				to: buildOrganizationDirectMessagePath({
					orgSlug: currentOrganization.slug,
					spaceId: response.spaceId,
					search: { profileId: response.memberProfileId },
				}),
			});
			input.onOpenChange(false);
			setSearch("");
		},
	});
	const people = (directory.data?.members ?? []).flatMap((m) =>
		m.user.id !== currentUserId && m.humanProfile?.status === "active"
			? [
					{
						id: m.humanProfile.profileId,
						name: m.humanProfile.profileName,
						kind: "human" as const,
						avatar: m.user.image,
						controller: null,
						owner: "",
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
			avatar: p.avatarUrl,
			controller: p.agentControllerRef,
			owner:
				directory.data?.members.find((m) => m.userId === p.ownerUserId)
					?.humanProfile?.profileName ?? "",
		}));
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>New chat</DialogTitle>
				</DialogHeader>
				<Button
					onClick={() => {
						input.onOpenChange(false);
						navigate({
							to: buildOrganizationCenterAgentChatPath(
								currentOrganization.slug,
								{ draft: "new", group: input.groupId }
							),
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
								{ label: "Local agents", items: agents },
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
												disabled={chat.isPending}
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
			</DialogContent>
		</Dialog>
	);
}
