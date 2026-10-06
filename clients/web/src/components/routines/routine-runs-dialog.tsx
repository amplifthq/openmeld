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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@openmeld/ui/components/table";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { ClockIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { AppEmptyState } from "#/components/app/app-empty-state";
import { useCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { resolveRoutineErrorMessage } from "#/lib/routines/api";
import { formatRoutineTimestamp } from "#/lib/routines/presentation";
import { routineRunResultHref } from "#/lib/routines/run-result";
import { routineRunsInfiniteQueryOptions } from "#/query/routines";
import { spaceStatusQueryOptions } from "#/query/spaces/status";
import { RoutineRunStatusBadge } from "./routine-run-presentation";

export function RoutineRunsDialog(input: {
	focusRunId?: string | null;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	organizationId: string;
	routine: CenterAgentRoutine | null;
}) {
	const query = useInfiniteQuery({
		...routineRunsInfiniteQueryOptions({
			enabled: input.open && input.routine !== null,
			organizationId: input.organizationId,
			routineId: input.routine?.id ?? "closed",
		}),
		refetchInterval: (state) =>
			state.state.data?.pages.some((page) =>
				page.runs.some(
					(run) => run.status === "claimed" || run.status === "submitted"
				)
			)
				? 5000
				: false,
	});
	const runs = query.data?.pages.flatMap((page) => page.runs) ?? [];
	const focusedRun = runs.find((run) => run.id === input.focusRunId);
	const focusedRef = useRef<HTMLTableRowElement>(null);
	useEffect(() => {
		if (
			!(input.open && input.focusRunId) ||
			focusedRun ||
			!query.isSuccess ||
			!query.hasNextPage ||
			query.isFetchingNextPage ||
			query.isFetchNextPageError
		) {
			return;
		}
		query
			.fetchNextPage()
			.catch((error) =>
				console.error("Failed to find the selected Routine run.", error)
			);
	}, [
		input.open,
		input.focusRunId,
		focusedRun,
		query.isSuccess,
		query.hasNextPage,
		query.isFetchingNextPage,
		query.isFetchNextPageError,
		query.fetchNextPage,
	]);
	useEffect(() => {
		if (focusedRun) {
			focusedRef.current?.scrollIntoView?.({ block: "nearest" });
		}
	}, [focusedRun]);
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Run history</DialogTitle>
					<DialogDescription>{input.routine?.name}</DialogDescription>
				</DialogHeader>
				{query.isPending ? <SkeletonRows label="Loading history" /> : null}
				{query.isError ? (
					<div className="text-destructive text-sm" role="alert">
						<p>{resolveRoutineErrorMessage(query.error, "runs")}</p>
						<Button
							className="mt-2"
							disabled={query.isFetching}
							onClick={() => query.refetch()}
							size="sm"
							variant="outline"
						>
							Retry
						</Button>
					</div>
				) : null}
				{query.isSuccess && runs.length === 0 ? (
					<AppEmptyState
						className="my-4"
						description="Results will appear here after the first run."
						icon={<ClockIcon className="size-5" />}
						title="No runs yet"
					/>
				) : null}
				{input.focusRunId &&
				query.isSuccess &&
				!focusedRun &&
				!query.hasNextPage ? (
					<p className="text-muted-foreground text-sm">
						This run is no longer available.
					</p>
				) : null}
				{runs.length ? (
					<ScrollArea
						className="min-h-0 flex-1"
						viewportClassName="max-h-[55dvh]"
					>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Run</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Sent to</TableHead>
									<TableHead>
										<span className="sr-only">Result</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{runs.map((run, index) => (
									<TableRow
										className={
											run.id === input.focusRunId ? "bg-accent/40" : undefined
										}
										index={index}
										key={run.id}
										ref={run.id === input.focusRunId ? focusedRef : undefined}
									>
										<TableCell className="min-w-40 align-top">
											<time dateTime={new Date(run.scheduledFor).toISOString()}>
												{formatRoutineTimestamp(run.scheduledFor)}
											</time>
											{run.finishedAtMs !== null ? (
												<p className="mt-1 text-muted-foreground text-xs">
													Finished {formatRoutineTimestamp(run.finishedAtMs)}
												</p>
											) : null}
											{run.failureDetail ? (
												<p className="mt-2 max-w-64 text-muted-foreground text-xs">
													{run.failureDetail}
												</p>
											) : null}
										</TableCell>
										<TableCell className="align-top">
											<RoutineRunStatusBadge status={run.status} />
										</TableCell>
										<RoutineRunDestination run={run} />
									</TableRow>
								))}
							</TableBody>
						</Table>
					</ScrollArea>
				) : null}
				{query.hasNextPage ? (
					<Button
						className="self-center"
						disabled={query.isFetchingNextPage}
						onClick={() => query.fetchNextPage()}
						variant="ghost"
					>
						{query.isFetchingNextPage ? "Loading…" : "Load more"}
					</Button>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function RoutineRunDestination({ run }: { run: CenterAgentRoutineRun }) {
	const organizationSlug = useCurrentOrganizationSlug();
	const space = useQuery(
		spaceStatusQueryOptions({
			spaceId: run.targetSpaceId ?? "",
			enabled: run.destinationKind === "space" && Boolean(run.targetSpaceId),
		})
	);
	const spaceHref =
		run.destinationKind === "space" && run.targetSpaceId
			? buildOrganizationSpacePath({
					orgSlug: organizationSlug,
					spaceId: run.targetSpaceId,
				})
			: null;
	const resultHref = routineRunResultHref(organizationSlug, run);
	let missingResult = "No result";
	if (run.status === "claimed" || run.status === "submitted") {
		missingResult = "Awaiting result";
	}
	if (run.publishedSignalId) {
		missingResult = "Result unavailable here";
	}
	return (
		<>
			<TableCell className="max-w-52 align-top">
				{spaceHref && !space.isError ? (
					<Link
						className="block truncate underline-offset-4 hover:underline"
						title={space.data?.name}
						to={spaceHref}
					>
						{space.data?.name ?? "Open Space"}
					</Link>
				) : (
					<span className="text-muted-foreground">
						{run.destinationKind === "space"
							? "Space unavailable"
							: "Connected conversation"}
					</span>
				)}
			</TableCell>
			<TableCell className="whitespace-nowrap text-right align-top">
				{resultHref && !space.isError ? (
					<Link className="underline-offset-4 hover:underline" to={resultHref}>
						View result
					</Link>
				) : (
					<span className="text-muted-foreground text-xs">{missingResult}</span>
				)}
			</TableCell>
		</>
	);
}
