import { runSpaceIndexMembershipOverlayReconcile } from "./lib/profiles/overlay-reconcile";
import { AuthRpcEntrypoint } from "./lib/rpc/entrypoint";

export class GatewayAuthRpcEntrypoint extends AuthRpcEntrypoint {}

class AuthEntrypoint extends AuthRpcEntrypoint {
  // Periodic Space Index overlay reconcile (physical-db-split.md D7). The
  // per-write onHistoryWritten hook is fire-and-forget, so a dropped or failed
  // Auth→Core announcement would otherwise leave the membership overlay
  // (pinned/last-joined) permanently stale. This bounded sweep re-derives the
  // overlay from openmeld_profile_space_history so the projection converges
  // automatically instead of needing a manual backfill.
  async scheduled(_controller: ScheduledController): Promise<void> {
    await runSpaceIndexMembershipOverlayReconcile(this.env);
  }
}

// biome-ignore lint/performance/noBarrelFile: Worker entrypoint intentionally re-exports app for tests/composition.
export { app } from "./lib/hono/create-hono-app";
export default AuthEntrypoint;
