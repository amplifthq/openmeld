import { beforeEach, describe, expect, it } from "vitest";
import { readOrCreateChatIntent } from "./center-agent-chat-intent";

describe("first chat send intent", () => {
	beforeEach(() => sessionStorage.clear());
	it("keeps the same creation and message identities when a response is lost or the page remounts", () => {
		const original = readOrCreateChatIntent(
			sessionStorage,
			"alice:org",
			"Draft a plan"
		);
		expect(
			readOrCreateChatIntent(sessionStorage, "alice:org", "Draft a plan")
		).toEqual(original);
	});
	it("isolates accounts and organizations and starts fresh after completion", () => {
		const original = readOrCreateChatIntent(
			sessionStorage,
			"alice:one",
			"Plan"
		);
		expect(
			readOrCreateChatIntent(sessionStorage, "bob:one", "Plan").creationId
		).not.toBe(original.creationId);
		expect(
			readOrCreateChatIntent(sessionStorage, "alice:two", "Plan").creationId
		).not.toBe(original.creationId);
		sessionStorage.removeItem("alice:one");
		expect(
			readOrCreateChatIntent(sessionStorage, "alice:one", "Plan").creationId
		).not.toBe(original.creationId);
	});
	it("reuses the reserved session if the user corrects a failed first message", () => {
		const original = readOrCreateChatIntent(
			sessionStorage,
			"alice:org",
			"Old request"
		);
		const corrected = readOrCreateChatIntent(
			sessionStorage,
			"alice:org",
			"Corrected request"
		);
		expect(corrected.creationId).toBe(original.creationId);
		expect(corrected.message.text).toBe("Corrected request");
		expect(corrected.message.clientMessageId).not.toBe(
			original.message.clientMessageId
		);
	});
});
