import { describe, expect, it } from "vitest";
import { shouldOfferWelcomeComputerSetup } from "./welcome-computer-setup";

describe("shouldOfferWelcomeComputerSetup", () => {
	it("offers setup when no service target and no computers exist", () => {
		expect(
			shouldOfferWelcomeComputerSetup({
				currentDeviceTargetAvailability: "missing",
				currentDeviceTargetReady: true,
				localRuntimeCount: 0,
				localRuntimesReady: true,
			})
		).toBe(true);
	});

	it("does not offer setup while computer state is still loading", () => {
		expect(
			shouldOfferWelcomeComputerSetup({
				currentDeviceTargetAvailability: undefined,
				currentDeviceTargetReady: false,
				localRuntimeCount: undefined,
				localRuntimesReady: false,
			})
		).toBe(false);
	});

	it("does not offer setup when a current service target exists", () => {
		expect(
			shouldOfferWelcomeComputerSetup({
				currentDeviceTargetAvailability: "resolved",
				currentDeviceTargetReady: true,
				localRuntimeCount: 0,
				localRuntimesReady: true,
			})
		).toBe(false);
	});

	it("does not offer setup when the account already has computers", () => {
		expect(
			shouldOfferWelcomeComputerSetup({
				currentDeviceTargetAvailability: "missing",
				currentDeviceTargetReady: true,
				localRuntimeCount: 1,
				localRuntimesReady: true,
			})
		).toBe(false);
	});
});
