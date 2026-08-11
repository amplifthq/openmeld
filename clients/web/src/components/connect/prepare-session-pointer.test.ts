import { describe, expect, it } from "vitest";
import {
	buildPrepareSessionKey,
	type PrepareSessionPointer,
	pointerMatchesCurrentComputerPrepareContext,
	pointerMatchesPrepareSessionInput,
} from "./prepare-session-pointer";

const BASE_POINTER = {
	deviceId: "device-1",
	humanProfileId: "human-1",
	opaqueToken: "token-1",
	opaqueTokenExpiresAt: "2026-06-29T08:00:00.000Z",
	prepareSessionId: "prepare-1",
	runtimeLane: "dev-local",
	targetSpaceId: "space-1",
} satisfies PrepareSessionPointer;

describe("buildPrepareSessionKey", () => {
	it("keys setup sessions by profile, device, runtime lane, and target space", () => {
		expect(
			buildPrepareSessionKey({
				deviceId: "device-1",
				humanProfileId: "human-1",
				runtimeLane: "dev-local",
				targetSpaceId: "space-1",
			})
		).toBe("human-1:device-1:dev-local:space-1");
	});

	it("does not build a key before the human profile is known", () => {
		expect(
			buildPrepareSessionKey({
				deviceId: "device-1",
				humanProfileId: null,
				runtimeLane: "dev-local",
				targetSpaceId: "space-1",
			})
		).toBeNull();
	});
});

describe("pointerMatchesPrepareSessionInput", () => {
	it("keeps reconnect setup attached to the same Computer when device identity rotates", () => {
		expect(
			pointerMatchesPrepareSessionInput(
				{
					...BASE_POINTER,
					connectedComputerId: "computer-1",
					deviceId: "device-after-reinstall",
				},
				{
					connectedComputerId: "computer-1",
					deviceId: "device-before-reinstall",
					humanProfileId: "human-1",
					runtimeLane: "dev-local",
					targetSpaceId: "space-1",
				}
			)
		).toBe(true);
	});

	it("keeps a pending Terminal setup pointer when the device and lane are not known yet", () => {
		const pendingPointer = {
			...BASE_POINTER,
			deviceId: null,
			runtimeLane: null,
		};

		expect(
			pointerMatchesPrepareSessionInput(pendingPointer, {
				deviceId: "device-1",
				humanProfileId: "human-1",
				runtimeLane: "dev-local",
				targetSpaceId: "space-1",
			})
		).toBe(true);
	});

	it("rejects a pointer from another device or runtime lane", () => {
		expect(
			pointerMatchesPrepareSessionInput(BASE_POINTER, {
				deviceId: "device-2",
				humanProfileId: "human-1",
				runtimeLane: "dev-local",
				targetSpaceId: "space-1",
			})
		).toBe(false);
		expect(
			pointerMatchesPrepareSessionInput(BASE_POINTER, {
				deviceId: "device-1",
				humanProfileId: "human-1",
				runtimeLane: "prod",
				targetSpaceId: "space-1",
			})
		).toBe(false);
	});
});

describe("pointerMatchesCurrentComputerPrepareContext", () => {
	it("rejects a setup pointer for a different current computer context", () => {
		expect(
			pointerMatchesCurrentComputerPrepareContext(BASE_POINTER, {
				deviceId: "device-2",
				humanProfileId: "human-1",
				runtimeLane: "dev-local",
			})
		).toBe(false);
	});
});
