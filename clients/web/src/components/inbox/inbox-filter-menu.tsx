import type { InboxFeedQuery } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { FluidDropdownMenuContent } from "@openmeld/ui/fluid/dropdown-menu";
import { FunnelSimpleIcon } from "@phosphor-icons/react";

export type InboxMenuFilters = {
	agentsOnly: boolean;
	peopleOnly: boolean;
	conversationType: NonNullable<InboxFeedQuery["conversationType"]>;
};
const conversationLabels = {
	all: "",
	direct_messages: "Direct messages",
	spaces: "Spaces",
};
export function InboxFilterMenu(input: {
	filters: InboxMenuFilters;
	onChange?: (filters: InboxMenuFilters) => void;
}) {
	const { filters } = input;
	let participant = "all";
	let participantLabel = "";
	if (filters.agentsOnly) {
		participant = "agents";
		participantLabel = "Agents";
	} else if (filters.peopleOnly) {
		participant = "people";
		participantLabel = "People";
	}
	const filterLabels = [
		participantLabel,
		conversationLabels[filters.conversationType],
	].filter(Boolean);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button aria-label="Filter Inbox" size="sm" variant="secondary" />
				}
			>
				<FunnelSimpleIcon aria-hidden="true" className="size-4" />
				{filterLabels.length
					? `Filters · ${filterLabels.join(" · ")}`
					: "Filters"}
			</DropdownMenuTrigger>
			<FluidDropdownMenuContent align="start" className="w-52">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Activity</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						onValueChange={(value) =>
							input.onChange?.({
								...filters,
								agentsOnly: value === "agents",
								peopleOnly: value === "people",
							})
						}
						value={participant}
					>
						<DropdownMenuRadioItem value="all">
							All activity
						</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="agents">Agents</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="people">People</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuLabel>Conversation</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						onValueChange={(value) => {
							if (
								value === "all" ||
								value === "direct_messages" ||
								value === "spaces"
							) {
								input.onChange?.({
									...filters,
									conversationType: value,
								});
							}
						}}
						value={filters.conversationType}
					>
						<DropdownMenuRadioItem value="all">
							All conversations
						</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="direct_messages">
							Direct messages
						</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="spaces">Spaces</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
				{filterLabels.length > 0 ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() =>
								input.onChange?.({
									agentsOnly: false,
									peopleOnly: false,
									conversationType: "all",
								})
							}
						>
							Clear filters
						</DropdownMenuItem>
					</>
				) : null}
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
}
