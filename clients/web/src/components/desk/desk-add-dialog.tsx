import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	// ChatCircleIcon,
	DesktopTowerIcon,
	HashIcon,
	PlusIcon,
	PulseIcon,
	TrayIcon,
	// UsersIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { SpaceAddMembersCandidateSummary } from "#/components/spaces/people-agent-picker-model";
import { buildOrganizationNewSpacePath } from "#/lib/organizations/organization-routes";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { DeskChatPicker } from "./desk-chat-picker";
import { DeskProfilePicker } from "./desk-profile-picker";
import type { DeskWidgetKind } from "./desk-widget-types";

const categories = [
	{ id: "spaces", label: "Spaces", icon: HashIcon },
	// MVP: enable these categories when their widgets are ready to ship.
	// { id: "chats", label: "Chats", icon: ChatCircleIcon },
	// { id: "updates", label: "Updates", icon: TrayIcon },
	// { id: "people", label: "People & Agents", icon: UsersIcon },
	// { id: "computers", label: "Computers", icon: DesktopTowerIcon },
] as const;
export function DeskAddDialog(input: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	spaces: readonly AccountSpaceItem[];
	shownIds: readonly string[];
	shownProfileIds: readonly string[];
	onProfiles: (profiles: readonly SpaceAddMembersCandidateSummary[]) => void;
	orgSlug: string;
	loading: boolean;
	error: boolean;
	onRetry: () => void;
	onAdd: (item: AccountSpaceItem) => void;
	onWidget: (kind: DeskWidgetKind) => void;
	onChat: (chat: { spaceId: string; profileId: string; title: string }) => void;
}) {
	const [category, setCategory] = useState<string>("spaces");
	const [query, setQuery] = useState("");
	const items = input.spaces.filter(
		(item) =>
			!item.directMessageProfileIds &&
			item.spaceName
				.toLocaleLowerCase()
				.includes(query.trim().toLocaleLowerCase())
	);
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-3xl">
				<DialogHeader className="border-b px-5 py-4">
					<DialogTitle>Add to Desk</DialogTitle>
					<DialogDescription>
						Choose a Space to add to your canvas.
					</DialogDescription>
				</DialogHeader>
				<div className="flex h-[440px] max-h-[65dvh] min-h-0">
					<nav
						aria-label="Widget categories"
						className="w-36 shrink-0 space-y-1 border-r bg-surface-1 p-2 sm:w-44"
					>
						{categories.map(({ id, label, icon: Icon }) => (
							<Button
								aria-current={category === id ? "page" : undefined}
								className="w-full justify-start gap-2"
								key={id}
								onClick={() => setCategory(id)}
								variant={category === id ? "secondary" : "ghost"}
							>
								<Icon aria-hidden />
								{label}
							</Button>
						))}
					</nav>
					<ScrollArea className="min-w-0 flex-1">
						<div className="space-y-4 p-5">
							<h2 className="font-medium text-base">
								{categories.find((c) => c.id === category)?.label}
							</h2>
							{category === "spaces" && (
								<>
									<Input
										aria-label="Search Spaces"
										onChange={(e) => setQuery(e.target.value)}
										placeholder="Search Spaces"
										value={query}
									/>
									{input.loading && <output>Loading Spaces…</output>}
									{input.error && (
										<div role="alert">
											Couldn’t load Spaces.{" "}
											<Button onClick={input.onRetry} variant="outline">
												Try again
											</Button>
										</div>
									)}
									{!(input.loading || input.error) && items.length === 0 && (
										<p className="text-muted-foreground text-sm">
											{query ? "No matching Spaces." : "No Spaces yet."}
										</p>
									)}
									<div className="space-y-1">
										{items.map((item) => (
											<Button
												className="h-auto w-full justify-between gap-3 py-3 text-left"
												key={item.spaceId}
												onClick={() => input.onAdd(item)}
												variant="ghost"
											>
												<span className="truncate">{item.spaceName}</span>
												<span className="shrink-0 text-muted-foreground text-xs">
													{input.shownIds.includes(item.spaceId)
														? "Show on Desk"
														: "Add"}
												</span>
											</Button>
										))}
									</div>
									<Link
										className={buttonVariants({ variant: "outline" })}
										to={buildOrganizationNewSpacePath(input.orgSlug)}
									>
										Create Space
									</Link>
								</>
							)}
							{category === "chats" && (
								<DeskChatPicker
									enabled={input.open}
									onOpenCenterAgent={() => input.onWidget("center")}
									onOpenChat={input.onChat}
								/>
							)}
							{category === "updates" && (
								<>
									<WidgetChoice
										description="See what agents are working on in your Spaces and chats."
										icon={PulseIcon}
										onAdd={() => input.onWidget("activity")}
										title="Active agents"
									/>
									<WidgetChoice
										description="Recent messages, updates, and requests for you."
										icon={TrayIcon}
										onAdd={() => input.onWidget("inbox")}
										title="Inbox"
									/>
								</>
							)}
							{category === "people" && (
								<DeskProfilePicker
									onAdd={input.onProfiles}
									shownIds={input.shownProfileIds}
								/>
							)}
							{category === "computers" && (
								<WidgetChoice
									description="See your computers and their connection status."
									icon={DesktopTowerIcon}
									onAdd={() => input.onWidget("computer")}
									title="Computers"
								/>
							)}
						</div>
					</ScrollArea>
				</div>
			</DialogContent>
		</Dialog>
	);
}
function WidgetChoice(input: {
	title: string;
	description: string;
	icon: typeof PlusIcon;
	onAdd: () => void;
}) {
	const Icon = input.icon;
	return (
		<div className="flex items-start gap-3 rounded-lg bg-surface-1 p-4 shadow-surface-1">
			<Icon
				aria-hidden
				className="mt-1 size-5 shrink-0 text-muted-foreground"
			/>
			<div className="min-w-0 flex-1">
				<h3 className="font-medium text-sm">{input.title}</h3>
				<p className="mt-1 text-muted-foreground text-sm">
					{input.description}
				</p>
			</div>
			<Button
				aria-label={`Add ${input.title}`}
				onClick={input.onAdd}
				size="sm"
				variant="outline"
			>
				<PlusIcon />
				Add
			</Button>
		</div>
	);
}
