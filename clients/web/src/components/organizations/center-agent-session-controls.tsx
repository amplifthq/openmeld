"use client";

import {
	createCenterAgentApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { ChatCircleIcon, CheckIcon, PlusIcon } from "@phosphor-icons/react";
import {
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { buildOrganizationCenterAgentChatPath } from "#/lib/organizations/organization-routes";

export function CenterAgentSessionControls(input: {
	organizationId: string;
	organizationSlug: string;
	memberProfileId: string;
	spaceId: string;
}) {
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const creationId = useRef<string | null>(null);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const api = useMemo(
		() =>
			createCenterAgentApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: input.organizationId,
				})
			),
		[input.organizationId]
	);
	const queryKey = [
		"center-agent",
		input.organizationId,
		input.memberProfileId,
		"sessions",
	] as const;
	const sessions = useInfiniteQuery({
		queryKey,
		enabled: open,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam, signal }) =>
			api.listSessions({
				...(pageParam === undefined ? {} : { cursor: pageParam }),
				signal,
			}),
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		staleTime: 0,
	});
	const reportError = (cause: unknown) => {
		setError(toStructuredApiClientFailure(cause).message);
		setOpen(true);
	};
	const openSession = async (spaceId: string) => {
		await navigate({
			to: buildOrganizationCenterAgentChatPath(input.organizationSlug, {
				session: spaceId,
			}),
		});
		setOpen(false);
	};
	const create = useMutation({
		mutationFn: async () => {
			creationId.current ??= crypto.randomUUID();
			const session = await api.createSession({
				creationId: creationId.current,
			});
			await queryClient.invalidateQueries({ queryKey });
			await openSession(session.spaceId);
			creationId.current = null;
		},
		onError: reportError,
	});
	const items = sessions.data?.pages.flatMap((page) => page.sessions) ?? [];
	return (
		<>
			<Button
				aria-label="New chat"
				disabled={create.isPending}
				onClick={() => {
					setError(null);
					create.mutate();
				}}
				size="icon-sm"
				title="New chat"
				variant="ghost"
			>
				<PlusIcon aria-hidden="true" />
			</Button>
			<DropdownMenu onOpenChange={setOpen} open={open}>
				<DropdownMenuTrigger
					render={
						<Button size="sm" variant="ghost">
							<ChatCircleIcon aria-hidden="true" />
							Chats
						</Button>
					}
				/>
				<FluidDropdownMenuContent
					align="end"
					className="w-72 max-w-[calc(100vw-2rem)]"
				>
					{error ? (
						<p className="px-2 py-1.5 text-destructive text-sm" role="alert">
							{error}
						</p>
					) : null}
					{sessions.isPending ? (
						<output className="px-2 py-1.5 text-muted-foreground text-sm">
							Loading chats…
						</output>
					) : null}
					{sessions.isError ? (
						<FluidDropdownMenuItem
							closeOnClick={false}
							index={0}
							onClick={() => {
								sessions.refetch().catch(reportError);
							}}
						>
							Could not load chats. Retry
						</FluidDropdownMenuItem>
					) : null}
					{!(sessions.isPending || sessions.isError) && items.length === 0 ? (
						<p className="px-2 py-1.5 text-muted-foreground text-sm">
							No chats yet. Start a new chat.
						</p>
					) : null}
					{items.map((session, index) => (
						<FluidDropdownMenuItem
							index={index + (sessions.isError ? 1 : 0)}
							key={session.spaceId}
							onClick={() => {
								setError(null);
								openSession(session.spaceId).catch(reportError);
							}}
						>
							<span className="min-w-0 flex-1">
								<span className="block truncate">
									{session.name?.trim() || "Untitled chat"}
								</span>
								{session.createdAt ? (
									<span className="block text-muted-foreground text-xs">
										{new Date(session.createdAt).toLocaleString()}
									</span>
								) : null}
							</span>
							{session.spaceId === input.spaceId ? (
								<CheckIcon aria-label="Current chat" />
							) : null}
						</FluidDropdownMenuItem>
					))}
					{sessions.hasNextPage ? (
						<FluidDropdownMenuItem
							closeOnClick={false}
							disabled={sessions.isFetchingNextPage}
							index={items.length + (sessions.isError ? 1 : 0)}
							onClick={() => {
								sessions.fetchNextPage().catch(reportError);
							}}
						>
							{sessions.isFetchingNextPage ? "Loading…" : "Load older chats"}
						</FluidDropdownMenuItem>
					) : null}
				</FluidDropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
