import type { RoutineManagement } from "@openmeld/schemas/types";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import { CheckCircleIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { listCurrentRoutineRuns } from "#/lib/routines/api";
import { formatRoutineTimestamp } from "#/lib/routines/presentation";
import { routineRunResultHref } from "#/lib/routines/run-result";
import {
	RoutineRunStatusBadge,
	resolveRoutineRunStatusTextClassName,
} from "./routine-run-presentation";

export function RoutineLastRun(input: {
	routine: RoutineManagement;
	onHistory: () => void;
}) {
	const { currentOrganization } = useAppOrganization();
	const navigate = useNavigate();
	const run = input.routine.lastRun;
	const result = useMutation({
		mutationFn: async () => {
			if (!run) {
				throw new Error("This run is no longer available.");
			}
			// Read the frozen run destination, never the Routine's current target.
			const response = await listCurrentRoutineRuns({
				organizationId: currentOrganization.id,
				routineId: input.routine.id,
				limit: 1,
				beforeScheduledFor: run.scheduledFor + 1,
			});
			const stored = response.runs.find((item) => item.id === run.id);
			const href = stored
				? routineRunResultHref(currentOrganization.slug, stored)
				: null;
			if (!href) {
				throw new Error(
					"This result is no longer available. Open run history for details."
				);
			}
			await navigate({ to: href });
		},
	});
	if (!run) {
		return <span className="text-muted-foreground">—</span>;
	}
	const completedResult =
		run.status === "completed" && Boolean(run.publishedSignalId);
	return (
		<div>
			<TooltipHint content={completedResult ? "Check result" : "Run history"}>
				<button
					aria-busy={completedResult && result.isPending}
					aria-label={`${completedResult ? "Check result" : "Run history"} for ${input.routine.name}`}
					className={cn(
						"group inline-flex items-center gap-1.5 whitespace-nowrap text-sm disabled:opacity-50",
						resolveRoutineRunStatusTextClassName(run.status)
					)}
					disabled={completedResult && result.isPending}
					onClick={completedResult ? () => result.mutate() : input.onHistory}
					type="button"
				>
					<time
						className="underline-offset-4 group-hover:underline"
						dateTime={new Date(run.scheduledFor).toISOString()}
					>
						{formatRoutineTimestamp(run.scheduledFor)}
					</time>
					{completedResult ? (
						<CheckCircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
					) : (
						<RoutineRunStatusBadge status={run.status} />
					)}
				</button>
			</TooltipHint>
			{result.isError ? (
				<p className="mt-1 max-w-56 text-destructive text-xs" role="alert">
					{result.error.message}
				</p>
			) : null}
		</div>
	);
}
