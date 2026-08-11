import type { WakeProgressItem } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveCenterAgentOptimisticReplyState } from "./center-agent-optimistic-reply";

describe("resolveCenterAgentOptimisticReplyState", () => {
	it.each([
		"sending",
		"request_sent",
		"queued",
		"connecting",
		"retrying",
		"running",
		"writing",
		"publishing",
	] satisfies WakeProgressItem["phase"][])("keeps the Center Agent answer shell on the canonical working state during %s", (phase) => {
		expect(resolveCenterAgentOptimisticReplyState(phase)).toBe("working");
	});

	it.each([
		"failed",
		"publication_unknown",
		"replied",
		"stopped",
	] satisfies WakeProgressItem["phase"][])("removes the optimistic Center Agent answer shell after %s", (phase) => {
		expect(resolveCenterAgentOptimisticReplyState(phase)).toBeNull();
	});
});
