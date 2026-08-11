import { describe, expect, it } from "vitest";
import {
	hasOpenMeldToolsUpdate,
	isOpenMeldToolsComponentUpdateActionable,
	isOpenMeldToolsComponentUpdateRequired,
} from "./openmeld-tools-update";

type LocalComponentsInput = Parameters<typeof hasOpenMeldToolsUpdate>[0];
type ComponentUpdateInput = Parameters<
	typeof isOpenMeldToolsComponentUpdateRequired
>[0];

describe("OpenMeld tools update helpers", () => {
	it("treats service, CLI, or skills updates as one tools update signal", () => {
		expect(
			hasOpenMeldToolsUpdate({
				cli: { status: "current", wakeBlocked: false },
				service: { status: "current", wakeBlocked: false },
				skills: { status: "update_available", wakeBlocked: false },
			} as LocalComponentsInput)
		).toBe(true);
		expect(
			hasOpenMeldToolsUpdate({
				cli: { status: "current", wakeBlocked: false },
				service: { status: "current", wakeBlocked: false },
				skills: { status: "current", wakeBlocked: false },
			} as LocalComponentsInput)
		).toBe(false);
	});

	it("treats wake-blocking component drift as required", () => {
		const update = {
			status: "current",
			wakeBlocked: true,
		} as ComponentUpdateInput;

		expect(isOpenMeldToolsComponentUpdateRequired(update)).toBe(true);
		expect(isOpenMeldToolsComponentUpdateActionable(update)).toBe(true);
	});
});
