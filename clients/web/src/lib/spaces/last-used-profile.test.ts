import { beforeEach, describe, expect, it } from "vitest";
import {
	readLastUsedHumanProfileId,
	resolveLastUsedHumanProfileStorageKey,
	writeLastUsedHumanProfileId,
} from "./last-used-profile";

describe("last-used human profile memory", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("round-trips a written profile id within a scope", () => {
		writeLastUsedHumanProfileId({
			profileId: "human-1",
			storageScope: "acct-a",
		});
		expect(readLastUsedHumanProfileId("acct-a")).toBe("human-1");
	});

	it("returns null when nothing is remembered", () => {
		expect(readLastUsedHumanProfileId("acct-a")).toBeNull();
	});

	it("isolates memory per storage scope", () => {
		writeLastUsedHumanProfileId({
			profileId: "human-1",
			storageScope: "acct-a",
		});
		expect(readLastUsedHumanProfileId("acct-b")).toBeNull();
		expect(resolveLastUsedHumanProfileStorageKey("acct-a")).not.toBe(
			resolveLastUsedHumanProfileStorageKey("acct-b")
		);
	});

	it("ignores blank writes and trims reads", () => {
		writeLastUsedHumanProfileId({
			profileId: "human-1",
			storageScope: "acct-a",
		});
		writeLastUsedHumanProfileId({ profileId: "   ", storageScope: "acct-a" });
		expect(readLastUsedHumanProfileId("acct-a")).toBe("human-1");

		window.localStorage.setItem(
			resolveLastUsedHumanProfileStorageKey("acct-a"),
			"  human-2  "
		);
		expect(readLastUsedHumanProfileId("acct-a")).toBe("human-2");
	});

	it("falls back to the unscoped key when no scope is given", () => {
		writeLastUsedHumanProfileId({ profileId: "human-9" });
		expect(readLastUsedHumanProfileId()).toBe("human-9");
		expect(resolveLastUsedHumanProfileStorageKey()).toBe(
			"openmeld:last-used-human-profile-id"
		);
	});
});
