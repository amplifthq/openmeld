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
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
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
	const preferences = useSidebarPreferences(profileId, organization.id);
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
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
		...session,
		title:
			preferences.preferences?.chats?.titles[session.spaceId] ??
			session.name ??
			"New chat",
	}));
	const matches = chats.filter((chat) =>
		chat.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
	);
	const selectChat = (session: string) => {
		setOpen(false);
		setSearch("");
		navigate({
			to: buildOrganizationCenterAgentChatPath(organization.slug, { session }),
		});
	};
	return (
		<h1
			className={cn(
				buttonVariants({ variant: "ghost" }),
				"group/chat-title relative h-auto min-w-0 max-w-[28rem] shrink gap-0 rounded-full p-0 text-lg transition-none hover:shadow-sm",
				open && "bg-muted shadow-sm"
			)}
		>
			<DropdownMenu
				modal={false}
				onOpenChange={(next) => {
					setOpen(next);
					if (!next) {
						setSearch("");
					}
				}}
				open={open}
			>
				<TooltipHint content={open ? undefined : "Open chat history"}>
					<DropdownMenuTrigger
						aria-label={`Open chat history: ${title}`}
						className="flex min-w-0 items-center rounded-full px-2 py-1 text-lg outline-none focus-visible:ring-1 focus-visible:ring-ring/50 disabled:opacity-50"
						disabled={disabled}
					>
						<span className="truncate">{title}</span>
						<CaretDownIcon
							aria-hidden="true"
							className="ml-1 size-3.5 shrink-0 text-muted-foreground"
						/>
						{titleAction ? (
							<span
								aria-hidden="true"
								className="w-0 shrink-0 group-focus-within/chat-title:w-7 group-hover/chat-title:w-7 [@media(hover:none)]:w-7"
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
									if (matches[0]) {
										selectChat(matches[0].spaceId);
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
					{spaceId ? (
						<FluidDropdownMenuItem
							className="my-1 px-3 text-sm"
							index={0}
							onClick={() =>
								navigate({
									to: buildOrganizationCenterAgentChatPath(organization.slug, {
										draft: "new",
									}),
								})
							}
						>
							<PlusIcon aria-hidden="true" />
							New chat
						</FluidDropdownMenuItem>
					) : null}
					{matches.length > 0 ? (
						<div className="px-3 pt-3 pb-1 text-muted-foreground text-xs">
							Chat history
						</div>
					) : null}
					{matches.map((chat, index) => (
						<FluidDropdownMenuItem
							aria-current={chat.spaceId === spaceId ? "page" : undefined}
							className="gap-3 px-3 py-2.5 text-sm"
							index={index + 1}
							key={chat.spaceId}
							onClick={() => selectChat(chat.spaceId)}
						>
							<span className="min-w-0 flex-1 truncate">{chat.title}</span>
							{chat.spaceId === spaceId ? (
								<span className="shrink-0 text-muted-foreground text-xs">
									Current
								</span>
							) : null}
							{chat.createdAt ? (
								<time
									className="shrink-0 text-muted-foreground text-xs"
									dateTime={chat.createdAt}
								>
									{new Date(chat.createdAt).toLocaleDateString(undefined, {
										month: "short",
										day: "numeric",
									})}
								</time>
							) : null}
						</FluidDropdownMenuItem>
					))}
					{sessions.isError ? (
						<div className="px-3 py-3 text-muted-foreground text-sm">
							Couldn’t load chat history.
							<button
								className="ml-2 underline"
								onClick={() =>
									sessions.hasNextPage
										? sessions.fetchNextPage()
										: sessions.refetch()
								}
								type="button"
							>
								Try again
							</button>
						</div>
					) : null}
					{!sessions.isError && sessions.isFetching ? (
						<output className="px-3 py-3 text-muted-foreground text-sm">
							Loading chat history…
						</output>
					) : null}
					{!(sessions.isError || sessions.isFetching) &&
					matches.length === 0 ? (
						<output className="px-3 py-4 text-muted-foreground text-sm">
							{search.trim()
								? "No matching chats. Try another search."
								: "No chats yet."}
						</output>
					) : null}
				</FluidDropdownMenuContent>
			</DropdownMenu>
			{titleAction ? (
				<span className="absolute top-1/2 right-1 flex -translate-y-1/2">
					<span className="pointer-events-none flex opacity-0 transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] [transform:translateX(-3px)] group-focus-within/chat-title:pointer-events-auto group-focus-within/chat-title:opacity-100 group-focus-within/chat-title:transition-none group-hover/chat-title:pointer-events-auto group-hover/chat-title:opacity-100 motion-reduce:transform-none motion-reduce:transition-none group-focus-within/chat-title:[transform:translateX(0)] group-hover/chat-title:[transform:translateX(0)] [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:transform-none [@media(hover:none)]:opacity-100">
						{titleAction}
					</span>
				</span>
			) : null}
		</h1>
	);
}
