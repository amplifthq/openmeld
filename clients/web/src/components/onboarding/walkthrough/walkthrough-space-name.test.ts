import { describe, expect, it } from "vitest";
import { nextWelcomeSpaceName } from "./walkthrough-space-name";

describe("welcome Space replay names", () => {
	it.each([
		[[], "Welcome to OpenMeld"],
		[["Welcome to OpenMeld"], "Welcome to OpenMeld (2)"],
		[
			["Welcome to OpenMeld", "Welcome to OpenMeld (2)"],
			"Welcome to OpenMeld (3)",
		],
		[[" welcome to openmeld "], "Welcome to OpenMeld (2)"],
		[["Welcome to OpenMeld (2)"], "Welcome to OpenMeld"],
	] as const)("avoids occupied titles", (names, expected) => {
		expect(nextWelcomeSpaceName(names)).toBe(expected);
	});
});
