import { describe, expect, it } from "vitest";
import { routineRunResultHref } from "./run-result";

describe("Routine result navigation", () => {
	it("opens the published message in the run's frozen Space", () => {
		const href = routineRunResultHref("acme", {
			destinationKind: "space",
			targetSpaceId: "original-space",
			publishedSignalId: "answer-1",
		});
		expect(href).toBe("/o/acme/spaces/original-space?focusSignalId=answer-1");
	});
	it.each([
		{
			destinationKind: "space" as const,
			targetSpaceId: "space-1",
			publishedSignalId: null,
		},
		{
			destinationKind: "space" as const,
			targetSpaceId: null,
			publishedSignalId: "answer-1",
		},
		{
			destinationKind: "slack_thread" as const,
			targetSpaceId: null,
			publishedSignalId: "1720000000.001",
		},
	])("does not invent a Space result for incomplete or external output: %j", (run) => {
		expect(routineRunResultHref("acme", run)).toBeNull();
	});
});
