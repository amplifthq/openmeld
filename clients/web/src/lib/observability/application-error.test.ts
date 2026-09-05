import { describe, expect, it } from "vitest";
import { summarizeApplicationError } from "./application-error";

const PRIVATE_CONTENT = /customer|contract|token|Users|https/;

describe("application error minimization", () => {
	it("keeps build locations without exception text, URL queries, or local paths", () => {
		const error = new TypeError(
			"Cannot read properties of undefined (reading 'component'); customer message: please send the contract"
		);
		error.stack = `${error.message}\n at Page (https://openmeld.ai/assets/page-a1b2.js:12:34)\n at private (/Users/felix/work/contracts.ts:1:2)`;
		const summary = summarizeApplicationError(
			error,
			"https://openmeld.ai/assets/lazy-b3c4.js?token=private"
		);
		expect(summary).toEqual({
			name: "TypeError",
			code: "undefined_property",
			frames: ["assets/page-a1b2.js:12:34", "assets/lazy-b3c4.js"],
		});
		expect(JSON.stringify(summary)).not.toMatch(PRIVATE_CONTENT);
	});

	it("does not serialize arbitrary rejection objects or error messages", () => {
		const input = {
			password: "private",
			message: "Please review my salary",
			toString() {
				throw new Error("no");
			},
		};
		expect(summarizeApplicationError(input)).toEqual({
			name: "Unknown",
			code: "unexpected",
			frames: [],
		});
		expect(
			summarizeApplicationError(new Error("Please review my salary"))
		).toEqual({ name: "Error", code: "unexpected", frames: [] });
	});
});
