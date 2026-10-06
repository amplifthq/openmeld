import type { RoutineManagement } from "@openmeld/schemas/types";

export type RoutineFilter =
	| "all"
	| "enabled"
	| "paused"
	| "completed"
	| "failed";
export type RoutineSort = "updated" | "next" | "name";

export function filterAndSortRoutines(
	routines: readonly RoutineManagement[],
	filter: RoutineFilter,
	sort: RoutineSort
) {
	return routines
		.filter((routine) => {
			if (filter === "all") {
				return true;
			}
			if (filter === "failed") {
				return routine.lastRun?.status === "failed";
			}
			return routine.status === filter;
		})
		.sort((a, b) => {
			if (sort === "name") {
				return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
			}
			if (sort === "next") {
				if (a.nextDueAt === null && b.nextDueAt !== null) {
					return 1;
				}
				if (b.nextDueAt === null && a.nextDueAt !== null) {
					return -1;
				}
				if (a.nextDueAt !== b.nextDueAt) {
					return (a.nextDueAt ?? 0) - (b.nextDueAt ?? 0);
				}
			}
			return b.updatedAtMs - a.updatedAtMs || a.id.localeCompare(b.id);
		});
}
