import type { CurrentLocalRuntimeReplyReadinessResponse } from "@openmeld/schemas/types";
import type { ComputerReplyReadiness } from "@openmeld/start";

export function mapCurrentLocalRuntimeReplyReadinessQueryState(input: {
	isFetching?: boolean;
	isPending: boolean;
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined;
}): ComputerReplyReadiness {
	if (input.isPending) {
		return {
			detailReasonCode: input.readiness?.service.reasonCodes[0] ?? null,
			executionTargetStatus:
				input.readiness?.runtime.executionTargetStatus ?? null,
			reasonCode: "start_state.checking",
			service: null,
			status: "checking",
		};
	}

	return input.readiness
		? mapCurrentLocalRuntimeReplyReadiness(input.readiness)
		: {
				detailReasonCode: null,
				executionTargetStatus: null,
				reasonCode: "device_reply_readiness.unknown",
				service: null,
				status: "unknown",
			};
}

export function mapCurrentLocalRuntimeReplyReadiness(
	readiness: CurrentLocalRuntimeReplyReadinessResponse
): ComputerReplyReadiness {
	const detailReasonCode =
		readiness.service.reasonCodes[0] ??
		resolveLocalComponentsReasonCode(readiness.localComponents) ??
		readiness.runtime.reasonCodes[0] ??
		null;
	const executionTargetStatus = readiness.runtime.executionTargetStatus;

	if (readiness.localComponents.service.wakeBlocked) {
		return {
			detailReasonCode,
			executionTargetStatus,
			reasonCode: "background_helper.update_required",
			service: null,
			status: "needs_repair",
		};
	}

	if (readiness.primaryBlocker === "none") {
		return {
			detailReasonCode,
			executionTargetStatus,
			reasonCode: "ready",
			service: null,
			status: "ready",
		};
	}

	if (readiness.primaryBlocker === "current_runtime_missing") {
		return {
			detailReasonCode,
			executionTargetStatus,
			reasonCode: "current_device.missing",
			service: null,
			status: "needs_setup",
		};
	}

	if (readiness.primaryBlocker === "service_not_connected") {
		return {
			detailReasonCode,
			executionTargetStatus,
			reasonCode: "background_helper.not_running",
			service: null,
			status: "needs_repair",
		};
	}

	if (readiness.primaryBlocker === "service_update_required") {
		return {
			detailReasonCode,
			executionTargetStatus,
			reasonCode: "background_helper.update_required",
			service: null,
			status: "needs_repair",
		};
	}

	if (readiness.primaryBlocker === "agent_controller_report_stale") {
		return {
			detailReasonCode,
			executionTargetStatus,
			reasonCode: "execution_target.stale",
			service: null,
			status: readiness.status === "checking" ? "checking" : "needs_repair",
		};
	}

	if (readiness.primaryBlocker === "agent_controller_report_not_ready") {
		if (readiness.nextAction === "check_status") {
			return {
				detailReasonCode,
				executionTargetStatus,
				reasonCode: "device_reply_readiness.unknown",
				service: null,
				status: "unknown",
			};
		}
		return {
			detailReasonCode,
			executionTargetStatus,
			reasonCode:
				executionTargetStatus === "partial"
					? "execution_target.partial"
					: "execution_target.not_ready",
			service: null,
			status: "needs_repair",
		};
	}

	return {
		detailReasonCode,
		executionTargetStatus,
		reasonCode:
			readiness.primaryBlocker === "agent_controller_report_unknown"
				? "execution_target.unknown"
				: "background_helper.unknown",
		service: null,
		status: "unknown",
	};
}

function resolveLocalComponentsReasonCode(
	localComponents: CurrentLocalRuntimeReplyReadinessResponse["localComponents"]
): string | null {
	return (
		localComponents.service.reasonCodes[0] ??
		localComponents.cli.reasonCodes[0] ??
		localComponents.skills.reasonCodes[0] ??
		null
	);
}
