import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { CaretDownIcon, PlusIcon } from "@phosphor-icons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationCenterAgentChatPath } from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { centerAgentSessionsQueryOptions } from "#/query/organizations/center-agent-sessions";

export function CenterAgentChatHistory({
	title,
	spaceId,
	disabled = false,
}: {
	title: string;
	spaceId?: string;
	disabled?: boolean;
}) {
	const { currentOrganization: organization } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const profileId = defaultHumanProfile?.openMeldProfileId ?? "";
	const preferences = useSidebarPreferences(profileId, organization.id);
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);
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
		<h1 className="min-w-0 max-w-[28rem] font-medium text-lg">
			<DropdownMenu
				modal={false}
				onOpenChange={(next) => {
					setOpen(next);
					if (!next) {
						setSearch("");
					}
				}}
				onOpenChangeComplete={(next) => {
					if (next) {
						searchRef.current?.focus();
					}
				}}
				open={open}
			>
				<TooltipHint content={open ? undefined : "Open chat history"}>
					<DropdownMenuTrigger
						aria-label={`Open chat history: ${title}`}
						disabled={disabled}
						render={
							<Button
								className="h-auto min-w-0 max-w-full shrink gap-2 rounded-full px-3 py-1 text-lg transition-none hover:shadow-sm data-popup-open:shadow-sm"
								variant="ghost"
							/>
						}
					>
						<span className="truncate">{title}</span>
						<CaretDownIcon
							aria-hidden="true"
							className="size-3.5 shrink-0 text-muted-foreground"
						/>
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
							ref={searchRef}
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
		</h1>
	);
}
