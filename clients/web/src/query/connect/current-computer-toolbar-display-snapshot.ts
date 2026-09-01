import { queryOptions, skipToken } from "@tanstack/react-query";
import { z } from "zod/v4";
import type { ComputerSummaryStatus } from "#/lib/computer-summary-status";
import { PERSISTED_DISPLAY_QUERY_GC_TIME_MS } from "#/query/query-config";
import { startQueryKeys } from "#/query/query-keys";

const currentComputerToolbarAttentionSchema = z.union([
	z.strictObject({
		reason: z.literal("agent_check_failed"),
		tone: z.literal("warning"),
	}),
	z.strictObject({
		reason: z.literal("agent_needs_setup"),
		tone: z.literal("warning"),
	}),
	z.strictObject({
		reason: z.literal("service_not_connected"),
		tone: z.literal("danger"),
	}),
	z.strictObject({
		reason: z.literal("openmeld_tools_update"),
		tone: z.enum(["warning", "danger"]),
	}),
]);

export const currentComputerToolbarDisplaySnapshotSchema = z.strictObject({
	currentComputer: z
		.strictObject({
			attention: currentComputerToolbarAttentionSchema.nullable(),
			deviceId: z.string().trim().min(1).max(256),
		})
		.nullable(),
	version: z.literal(1),
});

export type CurrentComputerToolbarDisplaySnapshot = z.infer<
	typeof currentComputerToolbarDisplaySnapshotSchema
>;

export function createCurrentComputerToolbarDisplaySnapshot(input: {
	deviceId: string | null;
	status: ComputerSummaryStatus | null;
}): CurrentComputerToolbarDisplaySnapshot {
	const deviceId = input.deviceId?.trim() ?? "";
	if (!deviceId) {
		return { currentComputer: null, version: 1 };
	}
	const attention = currentComputerToolbarAttentionSchema.safeParse({
		reason: input.status?.reason,
		tone: input.status?.tone,
	});
	return currentComputerToolbarDisplaySnapshotSchema.parse({
		currentComputer: {
			attention: attention.success ? attention.data : null,
			deviceId,
		},
		version: 1,
	});
}

export function readCurrentComputerToolbarAttention(
	snapshot: CurrentComputerToolbarDisplaySnapshot | undefined
): ComputerSummaryStatus | null {
	const attention = snapshot?.currentComputer?.attention;
	if (!attention) {
		return null;
	}
	switch (attention.reason) {
		case "agent_check_failed":
			return {
				label: "Couldn't check",
				reason: attention.reason,
				showLabel: true,
				tone: attention.tone,
			};
		case "agent_needs_setup":
			return {
				label: "Local agents need setup",
				reason: attention.reason,
				showLabel: true,
				tone: attention.tone,
			};
		case "service_not_connected":
			return {
				label: "OpenMeld Service is not connected",
				reason: attention.reason,
				showLabel: true,
				tone: attention.tone,
			};
		case "openmeld_tools_update":
			return {
				label:
					attention.tone === "danger" ? "Update required" : "Update available",
				reason: attention.reason,
				showLabel: true,
				tone: attention.tone,
			};
		default: {
			const unhandled: never = attention;
			return unhandled;
		}
	}
}

export function currentComputerToolbarDisplaySnapshotQueryOptions(input: {
	storageScope: string;
}) {
	return queryOptions<CurrentComputerToolbarDisplaySnapshot>({
		gcTime: PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
		queryFn: skipToken,
		queryKey: startQueryKeys.currentComputerToolbarDisplaySnapshot(
			input.storageScope
		),
		staleTime: Number.POSITIVE_INFINITY,
	});
}
