import { describe, expect, it } from "vitest";
import { isAdditionalHumanProfileCreationEnabled } from "./profile-capabilities";

const ENABLED_CAPABILITIES = {
	additionalHumanProfileCreationEnabled: true,
	ok: true as const,
};

describe("additional Human Profile creation capability", () => {
	it("opens the Human creation surface only for a current successful capability", () => {
		expect(
			isAdditionalHumanProfileCreationEnabled({
				data: ENABLED_CAPABILITIES,
				isError: false,
				isFetching: false,
			})
		).toBe(true);
	});

	it.each([
		{
			data: ENABLED_CAPABILITIES,
			isError: false,
			isFetching: true,
		},
		{
			data: ENABLED_CAPABILITIES,
			isError: true,
			isFetching: false,
		},
		{
			data: undefined,
			isError: false,
			isFetching: true,
		},
	])("fails closed for pending, failed, or missing capability state", (state) => {
		expect(isAdditionalHumanProfileCreationEnabled(state)).toBe(false);
	});
});
