import { afterEach, describe, expect, it, vi } from "vitest";
import { writeBrowserPreference } from "../../lib/spaces/browser-preference-storage";
import {
	readSpaceReadingHeaderPosition,
	resolveSpaceReadingHeaderPosition,
	spaceReadingHeaderStorageKey,
} from "./space-reading-header";

afterEach(() => {
	localStorage.clear();
	vi.restoreAllMocks();
});

describe("Space reading header persistence", () => {
	const scope = {
		organizationSlug: "workspace",
		profileId: "reader",
		spaceId: "design",
	};
	it.each([
		0, 96, 180,
	])("restores a position at %ipx only for the same Space, identity, and organization", (distance) => {
		const position = resolveSpaceReadingHeaderPosition(distance);
		writeBrowserPreference(
			spaceReadingHeaderStorageKey(scope),
			JSON.stringify(position)
		);
		expect(
			readSpaceReadingHeaderPosition(spaceReadingHeaderStorageKey(scope))
		).toEqual(position);
		for (const other of [
			{ ...scope, spaceId: "release" },
			{ ...scope, profileId: "other-reader" },
			{ ...scope, organizationSlug: "other-workspace" },
		]) {
			expect(
				readSpaceReadingHeaderPosition(spaceReadingHeaderStorageKey(other))
			).toBeUndefined();
		}
	});
	it.each([
		"not json",
		'{"compact":true}',
		JSON.stringify({
			compact: true,
			progress: 0.5,
			anchor: { distance: 72, progress: 1 },
		}),
	])("ignores invalid saved geometry: %s", (raw) => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const key = spaceReadingHeaderStorageKey(scope);
		writeBrowserPreference(key, raw);
		expect(readSpaceReadingHeaderPosition(key)).toBeUndefined();
		expect(localStorage.getItem(key)).toBeNull();
	});
});

describe("Space reading header position", () => {
	it("keeps a compact header stable through small reversals at the collapse boundary", () => {
		let position = resolveSpaceReadingHeaderPosition(0);
		position = resolveSpaceReadingHeaderPosition(180, position);
		for (const distance of [145, 143, 145, 143, 100, 98, 100, 98]) {
			position = resolveSpaceReadingHeaderPosition(distance, position);
			expect(position.compact).toBe(true);
			expect(position.progress).toBe(1);
		}
	});
	it("does not recollapse after reversing a few pixels at the expansion boundary", () => {
		let position = resolveSpaceReadingHeaderPosition(180);
		for (const distance of [71, 73, 71, 73, 100, 140]) {
			position = resolveSpaceReadingHeaderPosition(distance, position);
			expect(position.compact).toBe(false);
		}
		position = resolveSpaceReadingHeaderPosition(144, position);
		expect(position.compact).toBe(true);
	});
	it("holds still without scrolling and moves continuously back to the latest messages", () => {
		let position = resolveSpaceReadingHeaderPosition(0);
		position = resolveSpaceReadingHeaderPosition(96, position);
		expect(position.progress).toBeCloseTo(0.6);
		for (let frame = 0; frame < 10; frame++) {
			position = resolveSpaceReadingHeaderPosition(96, position);
			expect(position.progress).toBeCloseTo(0.6);
		}
		position = resolveSpaceReadingHeaderPosition(180, position);
		const before = resolveSpaceReadingHeaderPosition(72, position);
		const after = resolveSpaceReadingHeaderPosition(71, before);
		expect(before.progress - after.progress).toBeLessThan(0.03);
		expect(resolveSpaceReadingHeaderPosition(0, after)).toMatchObject({
			compact: false,
			progress: 0,
		});
	});
});
