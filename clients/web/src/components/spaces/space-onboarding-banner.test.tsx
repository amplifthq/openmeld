import { describe, expect, it } from "vitest";
import { resolveDeviceStatus } from "./space-onboarding-banner";

// resolveDeviceStatus turns the two device-related read models (the reply
// readiness query + whether the account has any connected computer) into the
// single device.status fact the onboarding planner consumes. Connectivity is a
// ServiceRuntime liveness fact, not a Binding fact. Two distinct first-paint
// states both look like "no data yet" and must NOT be conflated:
//   - connected user refreshing: a computer IS connected, readiness briefly
//     loading -> "unknown" so the planner does not flash "Connect this computer".
//   - brand-new user with no computer: the readiness query is permanently
//     disabled (isPending forever), but having no connected computer is a
//     definitive "not connected" -> the user must still get first-run guidance.
describe("resolveDeviceStatus", () => {
	it("reports connected when the service is connected", () => {
		expect(
			resolveDeviceStatus({
				noConnectedComputer: false,
				pending: false,
				serviceConnected: true,
			})
		).toBe("connected");
	});

	it("reports not_connected for a brand-new user with no computer, even while the disabled readiness query is perpetually pending", () => {
		// Regression guard: this is the first-run case. noConnectedComputer must win
		// over the (meaningless) pending flag so connect_this_computer becomes
		// available and the "set up your first agent" guidance shows.
		expect(
			resolveDeviceStatus({
				noConnectedComputer: true,
				pending: true,
				serviceConnected: null,
			})
		).toBe("not_connected");
	});

	it("reports unknown while a resolved device's readiness is still loading (no connect flash)", () => {
		expect(
			resolveDeviceStatus({
				noConnectedComputer: false,
				pending: true,
				serviceConnected: null,
			})
		).toBe("unknown");
	});

	it("reports not_connected when a resolved device's service is settled-disconnected", () => {
		expect(
			resolveDeviceStatus({
				noConnectedComputer: false,
				pending: false,
				serviceConnected: false,
			})
		).toBe("not_connected");
	});

	it("reports unknown when no signal is available yet (device target still loading)", () => {
		expect(
			resolveDeviceStatus({
				noConnectedComputer: false,
				pending: false,
				serviceConnected: null,
			})
		).toBe("unknown");
	});
});
