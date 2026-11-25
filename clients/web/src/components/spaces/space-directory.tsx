import type { OrganizationSpaceDirectoryWithMemberCountsItem } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
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
import { ChatCircleTextIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { DirectorySearch } from "../app/directory-search";
import {
	DirectoryCardGrid,
	DirectoryCardItem,
} from "../directory/directory-card-grid";
import { SpaceDirectoryPreview } from "./space-directory-preview";
import { SpaceLayoutSwitch, useSpaceLayout } from "./space-layout-switch";
import {
	resolveSpaceMemberAppearances,
	SpaceMemberAvatars,
} from "./space-member-avatars";

type DirectorySpace = OrganizationSpaceDirectoryWithMemberCountsItem;
type DirectoryLayout = "cards" | "table";
type DirectoryInput = {
	joinedSpaceIds: ReadonlySet<string>;
	canJoinSpaces: boolean;
	joinError: { message: string; spaceId: string } | null;
	onJoinSpace: (spaceId: string) => void;
	pendingJoinSpaceId: string | null;
	profileId: string;
	spaces: readonly DirectorySpace[];
	savedViewWarning: { isRetrying: boolean; onRetry: () => void } | null;
};

export function SpaceDirectory(input: DirectoryInput) {
	const { currentOrganization } = useAppOrganization();
	const { layout, setLayout } = useSpaceLayout(
		input.profileId,
		currentOrganization.id
	);
	const [search, setSearch] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [preview, setPreview] = useState<DirectorySpace | null>(null);
	const searchTerm = useDeferredValue(search.trim().toLowerCase());
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			organizationId: currentOrganization.id,
			enabled: true,
		})
	);
	// The account index can recognize a new membership before discovery does.
	const discoverable = input.spaces.filter(
		(space) =>
			!(space.joined || input.joinedSpaceIds.has(space.spaceId)) &&
			space.visibility === "public" &&
			space.name.toLowerCase().includes(searchTerm)
	);
	return (
		<section
			aria-label="Discover public groups"
			className="flex h-full min-h-0 flex-col"
		>
			<div className="flex min-h-16 shrink-0 items-center justify-end gap-3 px-[var(--app-page-inline-padding)] py-3">
				<div className="flex min-h-10 min-w-0 flex-wrap items-center justify-end gap-1">
					<SpaceLayoutSwitch layout={layout} setLayout={setLayout} />
					<DirectorySearch
						label="Search public groups"
						onChange={setSearch}
						onOpenChange={setSearchOpen}
						open={searchOpen}
						value={search}
					/>
				</div>
			</div>
			{input.savedViewWarning && (
				<output className="flex items-center justify-between px-[var(--app-page-inline-padding)] pb-3 text-muted-foreground text-sm">
					Couldn't refresh public groups. Showing the last saved view.
					<Button
						disabled={input.savedViewWarning.isRetrying}
						onClick={input.savedViewWarning.onRetry}
						size="sm"
						variant="ghost"
					>
						Retry
					</Button>
				</output>
			)}
			<ScrollArea
				className="min-h-0 flex-1"
				contentClassName="px-[calc(var(--app-page-inline-padding)_-_0.5rem)] pb-8"
			>
				<DiscoverList
					appearances={resolveSpaceMemberAppearances(directory.data)}
					input={input}
					layout={layout}
					onPreview={setPreview}
					searching={Boolean(searchTerm)}
					spaces={discoverable}
				/>
			</ScrollArea>
			<SpaceDirectoryPreview
				joinPending={input.pendingJoinSpaceId === preview?.spaceId}
				onClose={() => setPreview(null)}
				onJoinSpace={() => {
					if (preview) {
						input.onJoinSpace(preview.spaceId);
					}
				}}
				profileId={input.profileId}
				space={preview}
			/>
		</section>
	);
}

function DiscoverList({
	appearances,
	spaces,
	input,
	layout,
	onPreview,
	searching,
}: {
	appearances: ReturnType<typeof resolveSpaceMemberAppearances>;
	spaces: readonly DirectorySpace[];
	input: DirectoryInput;
	layout: DirectoryLayout;
	onPreview: (space: DirectorySpace) => void;
	searching: boolean;
}) {
	if (spaces.length === 0) {
		return (
			<p className="px-3 py-12 text-center text-muted-foreground text-sm">
				{searching
					? "No public groups match your search."
					: "No public groups to discover right now."}
			</p>
		);
	}
	if (layout === "cards") {
		return (
			<DirectoryCardGrid
				aria-label="Public groups"
				className="grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] px-2"
			>
				{spaces.map((space) => (
					<DirectoryCardItem
						className="border border-border"
						itemId={space.spaceId}
						key={space.spaceId}
					>
						<div className="@container/space-card flex min-h-52 flex-col gap-3 p-4">
							<button
								aria-label={space.name}
								className="flex flex-1 flex-col items-start gap-3 rounded-sm text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:ring-2 focus-visible:ring-ring"
								onClick={() => onPreview(space)}
								type="button"
							>
								<SpaceMemberAvatars
									appearances={appearances}
									layout="grid"
									memberCount={space.activeMemberCount}
									members={space.memberPreviews ?? []}
								/>
								<TooltipHint content={space.name}>
									<span className="relative z-10 line-clamp-2 font-medium text-sm">
										{space.name}
									</span>
								</TooltipHint>
							</button>
							<div className="flex items-center justify-between gap-3">
								<span className="min-w-0 text-muted-foreground text-xs">
									{space.activeMemberCount === null
										? "Member count unavailable"
										: `${space.activeMemberCount} ${space.activeMemberCount === 1 ? "member" : "members"}`}
								</span>
								<DiscoverActions input={input} space={space} />
							</div>
							{input.joinError?.spaceId === space.spaceId && (
								<p className="text-destructive text-xs" role="alert">
									{input.joinError.message}
								</p>
							)}
						</div>
					</DirectoryCardItem>
				))}
			</DirectoryCardGrid>
		);
	}
	return (
		<Table className="table-fixed">
			<TableHeader>
				<TableRow>
					<TableHead>Group</TableHead>
					<TableHead className="hidden w-28 sm:table-cell">Members</TableHead>
					<TableHead className="w-44">Explore</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{spaces.map((space, index) => (
					<TableRow className="border-0" index={index} key={space.spaceId}>
						<TableCell className="whitespace-normal py-5">
							<button
								className="flex items-center gap-2 text-left font-medium text-sm hover:underline"
								onClick={() => onPreview(space)}
								type="button"
							>
								<ChatCircleTextIcon className="size-4 shrink-0 text-muted-foreground" />
								{space.name}
							</button>
							{input.joinError?.spaceId === space.spaceId && (
								<p className="mt-2 text-destructive text-xs" role="alert">
									{input.joinError.message}
								</p>
							)}
						</TableCell>
						<TableCell className="hidden text-muted-foreground sm:table-cell">
							{space.activeMemberCount === null ? (
								<span>
									<span aria-hidden="true">—</span>
									<span className="sr-only">Member count unavailable</span>
								</span>
							) : (
								<span className="flex items-center gap-2">
									<UsersThreeIcon />
									{space.activeMemberCount}
								</span>
							)}
						</TableCell>
						<TableCell>
							<DiscoverActions input={input} space={space} />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function DiscoverActions({
	input,
	space,
}: {
	input: DirectoryInput;
	space: DirectorySpace;
}) {
	return (
		<div className="relative z-20 flex shrink-0 items-center gap-2">
			<Button
				aria-label={`Join ${space.name}`}
				disabled={
					!input.canJoinSpaces || input.pendingJoinSpaceId === space.spaceId
				}
				onClick={() => input.onJoinSpace(space.spaceId)}
				size="sm"
				variant="default"
			>
				{input.pendingJoinSpaceId === space.spaceId ? "Joining…" : "Join"}
			</Button>
		</div>
	);
}
