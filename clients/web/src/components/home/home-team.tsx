import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { OrganizationInviteLink } from "#/components/organizations/organization-invite-link";
import { CreateProfileDialog } from "#/components/profiles/create-profile-dialog";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";

export function HomeTeam(input: {
	onOpenSpace: (spaceId: string) => void;
	onCreateSpace: () => void;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const queryClient = useQueryClient();
	const [creating, setCreating] = useState(false);
	const [inviting, setInviting] = useState(false);
	const [search, setSearch] = useState("");
	const matches = (name: string) =>
		name.toLowerCase().includes(search.trim().toLowerCase());
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const role = directory.data?.members.find(
		(member) => member.userId === currentUserId
	)?.role;
	const chat = useMutation({
		mutationFn: (targetProfileId: string) =>
			openCurrentDirectMessageSpace({
				organizationId: currentOrganization.id,
				targetProfileId,
			}),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({
				queryKey: accountSpaceQueryKeys.all,
			});
			input.onOpenSpace(result.spaceId);
		},
	});
	return (
		<>
			<div className="flex flex-wrap gap-2 p-3">
				<Button onClick={() => setCreating(true)} size="sm" variant="outline">
					Create Agent
				</Button>
				{!currentOrganization.isPersonal &&
					(role === "owner" || role === "admin") && (
						<Button onClick={() => setInviting(true)} size="sm" variant="ghost">
							Invite people
						</Button>
					)}
				<Button onClick={input.onCreateSpace} size="sm" variant="ghost">
					Create a group
				</Button>
			</div>
			<div className="px-3 pb-2">
				<Input
					aria-label="Search people and Agents"
					onChange={(event) => setSearch(event.target.value)}
					placeholder="Search people and Agents"
					value={search}
				/>
			</div>
			{chat.isError && (
				<p className="px-3 text-sm" role="alert">
					{resolveDirectMessageOpenErrorMessage(chat.error)}
				</p>
			)}
			<ScrollArea className="min-h-0 flex-1">
				<div className="px-3 pb-3">
					{directory.isError && (
						<div role="alert">
							Couldn’t load people and Agents.
							<Button onClick={() => directory.refetch()}>Try again</Button>
						</div>
					)}
					{directory.isPending && (
						<p className="text-muted-foreground text-sm">Loading…</p>
					)}
					{directory.data && !directory.isError && (
						<>
							{directory.data.agentProfiles
								.filter(
									(agent) =>
										!agent.isCenterAgent &&
										agent.status === "active" &&
										matches(agent.profileName)
								)
								.map((agent) => (
									<Button
										className="w-full justify-start"
										disabled={chat.isPending}
										key={agent.profileId}
										onClick={() => chat.mutate(agent.profileId)}
										variant="ghost"
									>
										<span className="truncate">{agent.profileName}</span>
										<span className="ml-auto text-muted-foreground text-xs">
											Agent
										</span>
									</Button>
								))}
							{directory.data.members
								.filter(
									(member) =>
										member.userId !== currentUserId && matches(member.user.name)
								)
								.map((member) => (
									<Button
										className="w-full justify-start"
										disabled={!member.humanProfile || chat.isPending}
										key={member.userId}
										onClick={() =>
											member.humanProfile &&
											chat.mutate(member.humanProfile.profileId)
										}
										variant="ghost"
									>
										<span className="truncate">{member.user.name}</span>
									</Button>
								))}
							{!directory.data.agentProfiles.some(
								(agent) => !agent.isCenterAgent && agent.status === "active"
							) &&
								directory.data.members.length <= 1 && (
									<p className="py-2 text-muted-foreground text-sm">
										Create an Agent or start a Space to work with others.
									</p>
								)}
						</>
					)}
				</div>
			</ScrollArea>
			{creating && (
				<HomeCreateAgent
					onClose={() => setCreating(false)}
					onCreated={async (profileId) => {
						await chat.mutateAsync(profileId);
					}}
				/>
			)}
			<Dialog onOpenChange={setInviting} open={inviting}>
				<DialogContent>
					<DialogTitle>Invite people</DialogTitle>
					{inviting && (
						<OrganizationInviteLink organizationId={currentOrganization.id} />
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}

function HomeCreateAgent({
	onClose,
	onCreated,
}: {
	onClose: () => void;
	onCreated: (profileId: string) => Promise<void>;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const recovery = useLocalAgentRecoveryController({
		agentExecutionReadinessScope: "bound_runtime",
		loadAgentProfiles: false,
		loadSetupState: false,
	});
	return (
		<CreateProfileDialog
			agentOnly
			allowTeammateRequests={!currentOrganization.isPersonal}
			currentUserId={currentUserId}
			onAgentRequestCreated={async (request) => {
				if (request.createdAgentProfileId) {
					await onCreated(request.createdAgentProfileId);
				}
			}}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			onProfileCreated={(profile) => onCreated(profile.openMeldProfileId)}
			open
			organizationId={currentOrganization.id}
			orgSlug={currentOrganization.slug}
			recovery={recovery}
		/>
	);
}
