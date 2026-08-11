import { z } from "zod/v4";

export const REPLY_READINESS_LEVEL_VALUES = [
  "blocked",
  "degraded",
  "ready",
  "unknown",
] as const;

export const REPLY_READINESS_REASON_CODE_VALUES = [
  "service.not_installed",
  "service.drifted",
  "service.not_running",
  "service.account_mismatch",
  "service.auth_missing",
  "service.auth_stale",
  "dispatch.storage_not_ready",
  "service.gateway_chain_unhealthy",
  "profile.not_selected",
  "profile.inactive",
  "profile.unbound",
  "controller.binding.disabled",
  "projection.missing",
  "controller.registry.disabled",
  "controller.launch.choice_required",
  "controller.launch.needs_repair",
  "workspace.missing",
  "workspace.invalid",
  "runtime.adapter.unsupported",
  "controller.bootstrap.failed",
  "controller.gateway.unhealthy",
  "local_agents.none_needed",
  "route.offline",
  "route.not_registered",
] as const;

export const replyReadinessLevelSchema = z.enum(REPLY_READINESS_LEVEL_VALUES);

export const replyReadinessReasonCodeSchema = z.enum(
  REPLY_READINESS_REASON_CODE_VALUES
);
