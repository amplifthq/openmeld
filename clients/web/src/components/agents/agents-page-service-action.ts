import { formatLocalSetupActionLabel } from "@openmeld/schemas";
import type { ComputerReplyReadiness } from "@openmeld/start";

export function resolveCurrentLocalRuntimeServiceActionLabel(
	replyReadiness: ComputerReplyReadiness
): string | null {
	switch (replyReadiness.reasonCode) {
		case "background_helper.update_required":
		case "background_helper.installed_outdated":
			return formatLocalSetupActionLabel("update_service");
		case "background_helper.not_installed":
			return formatLocalSetupActionLabel("connect_service");
		case "background_helper.not_running":
		case "device_reply_readiness.blocked":
		case "device_reply_readiness.degraded":
		case "execution_target.stale":
		case "execution_target.unknown":
			return formatLocalSetupActionLabel("reconnect_service");
		case "current_device.missing":
		case "device_projection.missing":
			return formatLocalSetupActionLabel("connect_service");
		case "execution_target.partial":
		case "execution_target.not_ready":
		case "local_agent_preparation.not_found":
		case "local_agent_preparation.not_enabled":
			return formatLocalSetupActionLabel("connect_local_agent");
		default:
			return null;
	}
}
