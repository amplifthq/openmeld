import { Button } from "@openmeld/ui/components/button";
import { SkeletonTable } from "@openmeld/ui/components/skeleton-content";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@openmeld/ui/components/table";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { SidebarConversationTime } from "#/components/spaces/sidebar-conversation-time";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	organizationAgentRuntimeOverviewQueryOptions,
	organizationProfileDirectoryQueryOptions,
} from "#/query/organizations/organization-directory";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import {
	type AgentConversation,
	agentConversationLink,
	selectAgentConversations,
} from "./agent-conversations";
import type { DirectoryHumanProfileRow } from "./directory-human-profile-model";

export function AgentConversationsSection({
	member,
}: {
	member: DirectoryHumanProfileRow;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	if (
		!member.isCurrentUser ||
		member.userId !== currentUserId ||
		member.profileStatus !== "active"
	) {
		return null;
	}
	return (
		<OwnedAgentConversations
			agents={member.agentProfiles}
			organizationId={currentOrganization.id}
			orgSlug={currentOrganization.slug}
			viewerProfileId={member.id}
		/>
	);
}

export function AgentProfileConversationsSection(input: {
	agent: AgentConversation["agents"][number];
	viewerProfileId: string;
}) {
	const { currentOrganization } = useAppOrganization();
	return (
		<OwnedAgentConversations
			agents={[input.agent]}
			organizationId={currentOrganization.id}
			orgSlug={currentOrganization.slug}
			singleAgent
			viewerProfileId={input.viewerProfileId}
		/>
	);
}

function OwnedAgentConversations(input: {
	agents: AgentConversation["agents"];
	viewerProfileId: string;
	singleAgent?: boolean;
	organizationId: string;
	orgSlug: string;
}) {
	const runtime = useQuery(
		organizationAgentRuntimeOverviewQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const currentSpacesByAgent = new Map(
		runtime.data?.agentProfiles.flatMap((agent) => {
			const activity = agent.operationalContext;
			return activity?.status === "working" && activity.currentWorkLocation
				? [[agent.profileId, activity.currentWorkLocation.spaceId] as const]
				: [];
		})
	);
	const [agentId, setAgentId] = useState("all");
	const query = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: true,
			profileId: input.viewerProfileId,
		})
	);
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const avatarUrls = new Map(
		directory.data?.members.map((person) => [
			person.humanProfile?.profileId,
			person.user.image,
		])
	);
	const conversations = query.data
		? selectAgentConversations({
				sections: query.data,
				agents: input.agents,
				organizationId: input.organizationId,
			})
		: [];
	const visible =
		agentId === "all"
			? conversations
			: conversations.filter((item) =>
					item.agents.some((agent) => agent.id === agentId)
				);
	return (
		<section aria-label="Agent conversations" className="min-w-0 space-y-3">
			<div className="flex items-center justify-between gap-3">
				<h2 className="text-muted-foreground text-xs">Agent conversations</h2>
				{!input.singleAgent && input.agents.length > 1 ? (
					<Select
						onValueChange={(value) => setAgentId(value ?? "all")}
						value={agentId}
					>
						<SelectTrigger
							aria-label="Filter conversations by Agent"
							className="max-w-48 text-xs"
							displayValue={
								agentId === "all"
									? "All Agents"
									: input.agents.find((agent) => agent.id === agentId)?.name
							}
						/>
						<SelectContent>
							<SelectItem index={0} value="all">
								All Agents
							</SelectItem>
							{input.agents.map((agent, index) => (
								<SelectItem index={index + 1} key={agent.id} value={agent.id}>
									{agent.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : null}
			</div>
			{query.isError ? (
				<div className="flex items-center gap-3 text-muted-foreground text-sm">
					<p>Couldn’t load Agent conversations.</p>
					<Button onClick={() => query.refetch()} size="xs" variant="ghost">
						Try again
					</Button>
				</div>
			) : null}
			{query.isPending ? (
				<SkeletonTable
					columns={input.singleAgent ? 2 : 3}
					label="Loading conversations"
				/>
			) : null}
			{query.isSuccess && visible.length === 0 ? (
				<p className="rounded-md border border-border/60 px-4 py-5 text-muted-foreground text-sm">
					{!input.singleAgent && agentId === "all"
						? "Conversations with your Agents will appear here."
						: "No conversations with this Agent yet."}
				</p>
			) : null}
			{query.isSuccess && visible.length > 0 ? (
				<ScrollArea
					className="max-h-88 rounded-md border border-border/60"
					viewportProps={{
						"aria-label": "Agent conversations",
						role: "region",
					}}
				>
					<Table className="table-fixed text-sm">
						<TableHeader>
							<TableRow>
								<TableHead>Conversation</TableHead>
								{input.singleAgent ? null : (
									<TableHead className="w-[30%]">Agent</TableHead>
								)}
								<TableHead className="hidden w-28 text-right sm:table-cell">
									Last message
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{visible.map((conversation, index) => (
								<AgentConversationRow
									avatarUrls={avatarUrls}
									conversation={conversation}
									humanProfileId={input.viewerProfileId}
									index={index}
									isCurrentTask={conversation.agents.some(
										(agent) =>
											currentSpacesByAgent.get(agent.id) ===
											conversation.space.spaceId
									)}
									key={conversation.space.spaceId}
									orgSlug={input.orgSlug}
									showAgent={!input.singleAgent}
								/>
							))}
						</TableBody>
					</Table>
				</ScrollArea>
			) : null}
		</section>
	);
}

function AgentConversationRow(input: {
	isCurrentTask: boolean;
	showAgent: boolean;
	avatarUrls: ReadonlyMap<string | undefined, string | null>;
	conversation: AgentConversation;
	humanProfileId: string;
	index: number;
	orgSlug: string;
}) {
	const { space, agents } = input.conversation;
	const link = agentConversationLink(input);
	const people =
		space.memberPreviews?.filter(
			(profile) => profile.profileKind === "human"
		) ?? [];
	return (
		<TableRow index={input.index}>
			<TableCell className="whitespace-normal p-0">
				<Link
					className="block min-w-0 px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
					{...link}
				>
					<span className="block truncate font-medium">{space.spaceName}</span>
					{input.isCurrentTask ? (
						<span className="mt-1 block text-primary text-xs">Active task</span>
					) : null}
					{people.length > 0 ? (
						<span className="mt-1 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
							<span className="flex shrink-0 -space-x-1">
								{people.map((person) => (
									<DitherProfileAvatar
										avatarImageUrl={input.avatarUrls.get(person.profileId)}
										key={person.profileId}
										profileId={person.profileId}
										profileKind="human"
										profileName={person.profileName}
										size={16}
									/>
								))}
							</span>
							<span className="truncate">
								{people.map((person) => person.profileName).join(", ")}
								{(space.activeHumanCount ?? 0) > people.length
									? ` +${(space.activeHumanCount ?? 0) - people.length}`
									: ""}
							</span>
						</span>
					) : null}
					<span className="mt-1 block truncate text-muted-foreground text-xs">
						{space.messagePreview?.text ||
							(space.messagePreview === null
								? "No messages yet"
								: "Open conversation")}
					</span>
				</Link>
			</TableCell>
			{input.showAgent ? (
				<TableCell className="whitespace-normal align-top">
					{agents.map((agent) => (
						<TooltipHint content={agent.name} key={agent.id}>
							<span className="flex min-w-0 items-center gap-1.5">
								<AgentProfileControllerAvatar
									agentControllerRef={agent.agentControllerRef}
									profileId={agent.id}
									profileName={agent.name}
									size={18}
								/>
								<span className="truncate text-xs">{agent.name}</span>
							</span>
						</TooltipHint>
					))}
				</TableCell>
			) : null}
			<TableCell className="hidden text-right sm:table-cell">
				{space.messagePreview ? (
					<SidebarConversationTime timestamp={space.messagePreview.timestamp} />
				) : null}
			</TableCell>
		</TableRow>
	);
}
