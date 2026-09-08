import { describe, expect, it } from "vitest";
import { startQueryKeys } from "#/query/query-keys";

describe("start query keys", () => {
	it("scopes local-runtime and prepare-session query keys by storage scope", () => {
		expect(startQueryKeys.currentDeviceTarget("user-a")).toEqual([
			"start",
			"current-device-target",
			"user-a",
		]);
		expect(startQueryKeys.localRuntimes("user-a")).toEqual([
			"start",
			"people-computers",
			"user-a",
		]);
		expect(startQueryKeys.prepareSession("user-a", "prepare-123")).not.toEqual(
			startQueryKeys.prepareSession("user-b", "prepare-123")
		);
		expect(startQueryKeys.profiles("user-a", "device-123")).not.toEqual(
			startQueryKeys.profiles("user-b", "device-123")
		);
	});
});
