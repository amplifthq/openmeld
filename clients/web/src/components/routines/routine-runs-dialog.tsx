"use client";

import type {
	CenterAgentRoutine,
	CenterAgentRoutineRun,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { resolveRoutineErrorMessage } from "#/lib/routines/api";
import { formatRoutineTimestamp } from "#/lib/routines/presentation";
import { routineRunsInfiniteQueryOptions } from "#/query/routines";
import { RoutineRunStatusBadge } from "./routine-run-presentation";

export function RoutineRunsDialog(input: {
	focusRunId?: string | null;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	organizationId: string;
	routine: CenterAgentRoutine | null;
}) {
	const routineId = input.routine?.id ?? "closed";
	const runsQuery = useInfiniteQuery({
		...routineRunsInfiniteQueryOptions({
			enabled: input.open && input.routine !== null,
			organizationId: input.organizationId,
			routineId,
		}),
		refetchInterval: (query) =>
			query.state.data?.pages.some((page) =>
				page.runs.some(
					(run) => run.status === "claimed" || run.status === "submitted"
				)
			)
				? 5000
				: false,
	});
	const runs = runsQuery.data?.pages.flatMap((page) => page.runs) ?? [];
	const routineName = input.routine?.name ?? "routine";
	const focusedRun = runs.find((run) => run.id === input.focusRunId);
	const focusedRunRef = useRef<HTMLLIElement>(null);
	useEffect(() => {
		if (
			!input.focusRunId ||
			focusedRun ||
			!runsQuery.isSuccess ||
			!runsQuery.hasNextPage ||
			runsQuery.isFetchingNextPage
		) {
			return;
		}
		runsQuery.fetchNextPage().catch((error) => {
			console.error("Failed to find the selected Routine run.", error);
		});
	}, [
		input.focusRunId,
		focusedRun,
		runsQuery.isSuccess,
		runsQuery.hasNextPage,
		runsQuery.isFetchingNextPage,
		runsQuery.fetchNextPage,
	]);
	useEffect(() => {
		if (focusedRun) {
			focusedRunRef.current?.scrollIntoView?.({ block: "nearest" });
		}
	}, [focusedRun]);

	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Runs for {routineName}</DialogTitle>
					<DialogDescription>
						Scheduled work is listed newest first. Runs in progress stay visible
						until they finish.
					</DialogDescription>
				</DialogHeader>
				{runsQuery.isPending ? <SkeletonRows label="Loading runs" /> : null}
				{runsQuery.isError ? (
					<div className="rounded-md border border-destructive/50 bg-destructive/5 p-4">
						<p className="break-words text-destructive text-sm" role="alert">
							{resolveRoutineErrorMessage(runsQuery.error, "runs")}
						</p>
						<Button
							className="mt-3"
							disabled={runsQuery.isRefetching}
							onClick={() => {
								runsQuery.refetch().catch((error) => {
									console.error("Failed to refresh Routine runs.", error);
								});
							}}
							size="sm"
							type="button"
							variant="outline"
						>
							Retry
						</Button>
					</div>
				) : null}
				{runsQuery.isSuccess && runs.length === 0 ? (
					<p className="rounded-md border border-border/70 border-dashed p-5 text-center text-muted-foreground text-sm">
						No runs yet.
					</p>
				) : null}
				{input.focusRunId &&
				runsQuery.isSuccess &&
				!focusedRun &&
				!runsQuery.hasNextPage ? (
					<p className="break-words text-muted-foreground text-sm">
						Run {input.focusRunId} is no longer in the available history.
					</p>
				) : null}
				{runs.length > 0 ? (
					<ul className="divide-y divide-border/70 border border-border/70">
						{runs.map((run) => (
							<RoutineRunRow
								focused={run.id === input.focusRunId}
								key={run.id}
								ref={run.id === input.focusRunId ? focusedRunRef : undefined}
								run={run}
							/>
						))}
					</ul>
				) : null}
				{runsQuery.hasNextPage ? (
					<Button
						disabled={runsQuery.isFetchingNextPage}
						onClick={() => {
							runsQuery.fetchNextPage().catch((error) => {
								console.error("Failed to load more Routine runs.", error);
							});
						}}
						type="button"
						variant="outline"
					>
						{runsQuery.isFetchingNextPage ? "Loading more" : "Load more"}
					</Button>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function RoutineRunRow(input: {
	focused: boolean;
	ref?: React.Ref<HTMLLIElement>;
	run: CenterAgentRoutineRun;
}) {
	return (
		<li
			className={`min-w-0 px-4 py-4 ${input.focused ? "bg-accent/40" : ""}`}
			ref={input.ref}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					{input.focused ? (
						<p className="font-medium text-foreground text-xs">Selected Run</p>
					) : null}
					<p className="font-mono text-muted-foreground text-xs">
						{input.run.id}
					</p>
					<p className="mt-1 text-foreground text-sm">
						Scheduled{" "}
						<time dateTime={new Date(input.run.scheduledFor).toISOString()}>
							{formatRoutineTimestamp(input.run.scheduledFor)}
						</time>
					</p>
				</div>
				<RoutineRunStatusBadge status={input.run.status} />
			</div>
			<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
				{input.run.startedAtMs === null ? null : (
					<span>Started {formatRoutineTimestamp(input.run.startedAtMs)}</span>
				)}
				{input.run.finishedAtMs === null ? null : (
					<span>Finished {formatRoutineTimestamp(input.run.finishedAtMs)}</span>
				)}
				<span>{resolvePublishedResultLabel(input.run)}</span>
			</div>
			{input.run.status === "failed" ? (
				<div className="mt-3 border-destructive border-l-2 pl-3 text-destructive text-xs leading-5">
					{input.run.failureCode ? (
						<p className="break-words font-mono">{input.run.failureCode}</p>
					) : null}
					{input.run.failureDetail ? (
						<p className="mt-1 break-words">{input.run.failureDetail}</p>
					) : null}
				</div>
			) : null}
			{input.run.status === "skipped" && input.run.failureDetail ? (
				<p className="mt-3 break-words border-border border-l-2 pl-3 text-muted-foreground text-xs leading-5">
					{input.run.failureDetail}
				</p>
			) : null}
		</li>
	);
}

function resolvePublishedResultLabel(run: CenterAgentRoutineRun): string {
	if (run.status === "claimed" || run.status === "submitted") {
		return "Result pending";
	}
	return run.publishedSignalId ? "Result published" : "No published result";
}
