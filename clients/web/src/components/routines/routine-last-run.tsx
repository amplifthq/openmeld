import type { RoutineManagement } from "@openmeld/schemas/types";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { listCurrentRoutineRuns } from "#/lib/routines/api";
import { formatRoutineTimestamp } from "#/lib/routines/presentation";
import { routineRunResultHref } from "#/lib/routines/run-result";
import { RoutineRunStatusBadge } from "./routine-run-presentation";

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
	return (
		<div className="flex flex-col items-start gap-1.5">
			<button
				aria-label={`Run history for ${input.routine.name}`}
				onClick={input.onHistory}
				type="button"
			>
				<RoutineRunStatusBadge status={run.status} />
			</button>
			<time
				className="whitespace-nowrap text-muted-foreground text-xs"
				dateTime={new Date(run.scheduledFor).toISOString()}
			>
				{formatRoutineTimestamp(run.scheduledFor)}
			</time>
			{run.publishedSignalId ? (
				<button
					className="text-sm underline-offset-4 hover:underline disabled:opacity-50"
					disabled={result.isPending}
					onClick={() => result.mutate()}
					type="button"
				>
					{result.isPending ? "Opening…" : "View result"}
				</button>
			) : null}
			{result.isError ? (
				<p className="max-w-56 text-destructive text-xs" role="alert">
					{result.error.message}
				</p>
			) : null}
		</div>
	);
}
