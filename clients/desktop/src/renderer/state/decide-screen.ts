import type { AuthView, ServiceView } from "../../shared/view-types";

// The 3-axis decision function (auth / service lifecycle / command-surface).
// One state -> one primary action. Priority order; first match wins.
// UPDATE_REQUIRED is intentionally P1 (the floor signal is dormant) and not
// routed here yet; strict route/binding "reachable" is also P1 (P0 CONNECTED =
// liveness, honest copy). See developing/clients/desktop-l45-design-proposal.md.

export type ScreenId =
  | "sign_in"
  | "needs_attention"
  | "set_up"
  | "stopped"
  | "connected";

export function decideScreen(input: {
  auth: AuthView;
  service: ServiceView;
}): ScreenId {
  const { auth, service } = input;

  // Axis 1 — auth. Only a definitive "signed out" gates; unknown proceeds.
  if (auth.signedIn === false) {
    return "sign_in";
  }

  // Axis 3 — command surface. CLI not found is NOT "service down".
  if (service.problem?.kind === "spawn_failed") {
    return "needs_attention";
  }

  // Axis 2 — local service lifecycle.
  if (service.lifecycle === "not_installed") {
    return "set_up";
  }
  if (service.lifecycle === "stopped") {
    return "stopped";
  }
  if (service.lifecycle === "running") {
    return "connected";
  }

  // unknown / other failure
  return "needs_attention";
}
