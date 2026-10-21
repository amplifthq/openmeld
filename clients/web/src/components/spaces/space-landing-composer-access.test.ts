import { describe, expect, it } from "vitest";
import { isSpaceComposerAccessPending } from "./use-space-composer-region";

describe("isSpaceComposerAccessPending", () => {
	const base = { isDeleted: false, membersFailed: false } as const;

	it("waits only while membership is unknown", () => {
		expect(
			isSpaceComposerAccessPending({ ...base, membershipState: "unknown" })
		).toBe(true);
	});

	it("shows the input or the Join prompt once membership is known", () => {
		expect(
			isSpaceComposerAccessPending({ ...base, membershipState: "member" })
		).toBe(false);
		expect(
			isSpaceComposerAccessPending({ ...base, membershipState: "nonmember" })
		).toBe(false);
	});

	it("never blocks a deleted Space or a failed member load", () => {
		expect(
			isSpaceComposerAccessPending({
				...base,
				isDeleted: true,
				membershipState: "unknown",
			})
		).toBe(false);
		expect(
			isSpaceComposerAccessPending({
				...base,
				membersFailed: true,
				membershipState: "unknown",
			})
		).toBe(false);
	});
});
