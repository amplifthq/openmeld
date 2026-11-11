import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyConnectionFailureReason,
  createServiceConnectionStateTracker,
  toHealthProjection,
} from "../../../clients/openmeld-cli/src/local-service/state/service-connection-state.ts";
import { runTlc } from "../formal-verification-tlc/run-tlc.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const health = (state, extra = {}) =>
  toHealthProjection({
    authState: null,
    detail: null,
    reason: null,
    state,
    updatedAt: "2026-11-09T00:00:00.000Z",
    ...extra,
  });

for (const [phase, state, runtimeState] of [
  ["starting", "degraded", "suspect"],
  ["connecting", "degraded", "suspect"],
  ["authentication_required", "degraded", "suspect"],
  ["online", "ok", "healthy"],
  ["degraded", "degraded", "suspect"],
  ["stopping", "degraded", "idle"],
]) {
  const projection = health(phase);
  if (projection.state !== state || projection.runtimeState !== runtimeState) {
    fail(
      `${phase} reported ${projection.state}/${projection.runtimeState}, expected ${state}/${runtimeState}`
    );
  }
}
if (health("stopping").reasonCode !== "stopping") {
  fail("stopping must keep its own reason code");
}
if (
  health("authentication_required", {
    authState: "expired",
    reason: "auth_rejected",
  }).reasonCode !== "authentication_required"
) {
  fail("sign-in required must keep its own reason code");
}
if (
  health("degraded", { reason: "auth_unavailable" }).reasonCode !==
  "auth_unavailable"
) {
  fail(
    "unusable saved sign-in is degraded auth_unavailable, not sign-in required"
  );
}

const upgrade500 =
  'daemon stream upgrade rejected (status=500, requestId="req_401", bodyExcerpt="socket timeout")';
if (classifyConnectionFailureReason(upgrade500) !== "internal") {
  fail(
    "a non-401 stream upgrade rejection is internal, even when the text says socket or 401"
  );
}
if (
  classifyConnectionFailureReason(
    'daemon stream upgrade rejected (status=401, requestId="req_123", bodyExcerpt="authentication required")'
  ) !== "auth_rejected"
) {
  fail("a 401 stream upgrade rejection is auth_rejected");
}
if (
  classifyConnectionFailureReason("connect timeout") !== "network_unreachable"
) {
  fail("a timeout is a network failure");
}

let transitions = 0;
const tracker = createServiceConnectionStateTracker({
  onTransition: () => {
    transitions += 1;
  },
});
tracker.set("connecting", { reason: "reconnecting" });
tracker.set("connecting", { reason: "reconnecting" });
if (transitions !== 1) {
  fail("repeating the same connection state must not log another transition");
}
tracker.set("online");
if (
  tracker.get().reason !== null ||
  toHealthProjection(tracker.get()).state !== "ok"
) {
  fail(
    "a heartbeat clears the reconnect reason and the health projection is ready"
  );
}

await runTlc({ specDir: here, moduleName: "ServiceConnection" });

console.log(
  "Service connection: health projection and failure classification match the code, and the connection loop model holds."
);
