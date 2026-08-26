import { runDeletedProfileReconcileOutbox } from "./lib/profiles/deleted-profile-reconcile";
import { runSpaceIndexMembershipOverlayReconcile } from "./lib/profiles/overlay-reconcile";
import { AuthRpcEntrypoint } from "./lib/rpc/entrypoint";

export class GatewayAuthRpcEntrypoint extends AuthRpcEntrypoint {}

class AuthEntrypoint extends AuthRpcEntrypoint {
  // Periodic convergence for Auth-owned cross-service work. The overlay sweep
  // repairs dropped Profile history projections. The deletion outbox retries
  // Wake cancellation, Binding cleanup, and Space removal until Core confirms
  // the whole Profile deletion lifecycle is complete.
  async scheduled(_controller: ScheduledController): Promise<void> {
    await Promise.all([
      runSpaceIndexMembershipOverlayReconcile(this.env),
      runDeletedProfileReconcileOutbox(this.env),
    ]);
  }
}

// biome-ignore lint/performance/noBarrelFile: Worker entrypoint intentionally re-exports app for tests/composition.
export { app } from "./lib/hono/create-hono-app";
export default AuthEntrypoint;
