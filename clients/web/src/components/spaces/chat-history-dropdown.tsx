import { buttonVariants } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { CaretDownIcon, PlusIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { SidebarConversationTime } from "./sidebar-conversation-time";

export type ChatHistoryItem = {
	spaceId: string;
	title: string;
	createdAt?: string | null;
	/** Last message time; shown instead of the creation date. */
	activityAt?: number | null;
	/** Muted secondary text, e.g. the chat's Profile. */
	detail?: string;
	/** Status marks of this chat, e.g. SpaceStatusIndicator. */
	status?: ReactNode;
	/** Words for the status marks, read with the item. */
	statusLabel?: string | null;
};

export type ChatHistoryGroup = {
	id: string;
	/** Shown above the group's chats; one-group lists use "Chat history".
	 *  Omit it for a list without a header. */
	label?: string;
	items: readonly ChatHistoryItem[];
	isLoading: boolean;
	isError: boolean;
	onRetry?: () => void;
};

/**
 * The chat title that opens a conversation's chat history: New chat, search,
 * every chat (in groups when a caller passes several), the current one
 * marked. Used by Center Agent chats and MemberAgent Direct Messages alike.
 */
export function ChatHistoryDropdown(input: {
	title: string;
	ariaLabel: string;
	currentSpaceId?: string;
	groups: readonly ChatHistoryGroup[];
	onSelect: (spaceId: string) => void;
	onNewChat?: () => void;
	newChatDisabled?: boolean;
	disabled?: boolean;
	/** Status marks beside the title, e.g. chats that need attention. */
	titleStatus?: ReactNode;
	/** Revealed on hover beside the title, e.g. the rename control. */
	titleAction?: ReactNode;
	/** Extra items after the chats, e.g. Delete chat. */
	renderTrailingItems?: (startIndex: number) => ReactNode;
	onOpenChange?: (open: boolean) => void;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const term = search.trim().toLocaleLowerCase();
	const groups = input.groups.map((group) => ({
		...group,
		matches: group.items.filter((item) =>
			item.title.toLocaleLowerCase().includes(term)
		),
	}));
	const allMatches = groups.flatMap((group) => group.matches);
	const isLoading = groups.some((group) => group.isLoading);
	const select = (spaceId: string) => {
		setOpen(false);
		setSearch("");
		input.onSelect(spaceId);
	};
	const now = new Date();
	let index = 0;
	return (
		<h1
			className={cn(
				buttonVariants({ variant: "ghost" }),
				"group/chat-title relative ml-[var(--space-title-control-inline-offset,0px)] h-auto min-w-0 max-w-full shrink gap-0 rounded-full border-0 p-0 text-lg transition-none hover:shadow-sm",
				open && "bg-muted shadow-sm"
			)}
		>
			<DropdownMenu
				modal={false}
				onOpenChange={(next) => {
					setOpen(next);
					input.onOpenChange?.(next);
					if (!next) {
						setSearch("");
					}
				}}
				open={open}
			>
				<TooltipHint content={open ? undefined : "Open chat history"}>
					<DropdownMenuTrigger
						aria-label={input.ariaLabel}
						className="flex min-w-0 items-center rounded-full px-2 py-1 text-lg outline-none focus-visible:ring-1 focus-visible:ring-ring/50 disabled:opacity-50"
						disabled={input.disabled}
					>
						<span className="truncate">{input.title}</span>
						{input.titleStatus ? (
							<span className="ml-2 inline-flex shrink-0">
								{input.titleStatus}
							</span>
						) : null}
						<CaretDownIcon
							aria-hidden="true"
							className="ml-1 size-3.5 shrink-0 text-muted-foreground"
						/>
						{input.titleAction ? (
							<span
								aria-hidden="true"
								className="w-0 shrink-0 transition-[width] delay-150 duration-0 group-focus-within/chat-title:w-7 group-focus-within/chat-title:delay-0 group-hover/chat-title:w-7 group-hover/chat-title:delay-0 motion-reduce:delay-0 [@media(hover:none)]:w-7"
							/>
						) : null}
					</DropdownMenuTrigger>
				</TooltipHint>
				<FluidDropdownMenuContent
					align="start"
					className="max-h-[min(26rem,var(--available-height))] w-[min(24rem,calc(100vw-2rem))] rounded-xl"
					sideOffset={8}
				>
					<div className="sticky top-0 z-10 border-b bg-popover px-3 py-2">
						<input
							aria-label="Search chat history"
							autoFocus
							className="w-full bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground"
							onChange={(event) => setSearch(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.nativeEvent.isComposing) {
									event.preventDefault();
									if (allMatches[0]) {
										select(allMatches[0].spaceId);
									}
								}
								if (
									event.key !== "Escape" &&
									event.key !== "Tab" &&
									event.key !== "ArrowDown" &&
									event.key !== "ArrowUp"
								) {
									event.stopPropagation();
								}
							}}
							placeholder="Search chat history"
							type="search"
							value={search}
						/>
					</div>
					{input.onNewChat ? (
						<FluidDropdownMenuItem
							className="my-1 px-3 text-sm"
							disabled={input.newChatDisabled}
							index={index++}
							onClick={input.onNewChat}
						>
							<PlusIcon aria-hidden="true" />
							New chat
						</FluidDropdownMenuItem>
					) : null}
					{groups.map((group) => (
						<div key={group.id}>
							{group.label &&
							(group.matches.length > 0 || groups.length > 1) ? (
								<div className="px-3 pt-3 pb-1 text-muted-foreground text-xs">
									{group.label}
								</div>
							) : null}
							{group.matches.map((item) => (
								<FluidDropdownMenuItem
									aria-current={
										item.spaceId === input.currentSpaceId ? "page" : undefined
									}
									className="gap-3 px-3 py-2.5 text-sm"
									index={index++}
									key={item.spaceId}
									onClick={() => select(item.spaceId)}
								>
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate">{item.title}</span>
										{item.detail ? (
											<span className="truncate text-muted-foreground text-xs">
												{item.detail}
											</span>
										) : null}
									</span>
									{item.status}
									{item.statusLabel ? (
										<span className="sr-only">{`, ${item.statusLabel}`}</span>
									) : null}
									{item.spaceId === input.currentSpaceId ? (
										<span className="shrink-0 text-muted-foreground text-xs">
											Current
										</span>
									) : null}
									<ChatHistoryItemTime item={item} now={now} />
								</FluidDropdownMenuItem>
							))}
							{group.isError ? (
								<div className="px-3 py-3 text-muted-foreground text-sm">
									Couldn’t load chat history.
									{group.onRetry ? (
										<button
											className="ml-2 underline"
											onClick={group.onRetry}
											type="button"
										>
											Try again
										</button>
									) : null}
								</div>
							) : null}
						</div>
					))}
					{isLoading ? (
						<output className="block px-3 py-3 text-muted-foreground text-sm">
							Loading chat history…
						</output>
					) : null}
					{!(isLoading || groups.some((group) => group.isError)) &&
					allMatches.length === 0 ? (
						<output className="block px-3 py-4 text-muted-foreground text-sm">
							{term
								? "No matching chats. Try another search."
								: "No chats yet."}
						</output>
					) : null}
					{input.renderTrailingItems?.(index)}
				</FluidDropdownMenuContent>
			</DropdownMenu>
			{input.titleAction ? (
				<span className="pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 overflow-clip">
					<span className="pointer-events-none flex opacity-0 blur-[2px] transition-[opacity,transform,filter] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] [transform:translateX(-8px)] group-focus-within/chat-title:pointer-events-auto group-focus-within/chat-title:opacity-100 group-focus-within/chat-title:blur-none group-focus-within/chat-title:transition-none group-hover/chat-title:pointer-events-auto group-hover/chat-title:opacity-100 group-hover/chat-title:blur-none motion-reduce:transform-none motion-reduce:blur-none motion-reduce:transition-none group-focus-within/chat-title:[transform:translateX(0)] group-hover/chat-title:[transform:translateX(0)] [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:transform-none [@media(hover:none)]:opacity-100 [@media(hover:none)]:blur-none">
						{input.titleAction}
					</span>
				</span>
			) : null}
		</h1>
	);
}

function ChatHistoryItemTime(input: { item: ChatHistoryItem; now: Date }) {
	if (input.item.activityAt != null) {
		return (
			<SidebarConversationTime
				className="text-xs"
				now={input.now}
				timestamp={input.item.activityAt}
			/>
		);
	}
	if (!input.item.createdAt) {
		return null;
	}
	return (
		<time
			className="shrink-0 text-muted-foreground text-xs"
			dateTime={input.item.createdAt}
		>
			{new Date(input.item.createdAt).toLocaleDateString(undefined, {
				month: "short",
				day: "numeric",
			})}
		</time>
	);
}
