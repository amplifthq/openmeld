import { describe, expect, it } from "vitest";
import { hasTutorialReply } from "./walkthrough-reply";

describe("tutorial reply", () => {
	it("waits for the Center Agent's final reply to this person's sent Wake", () => {
		const message = {
			id: "my-message",
			actorProfileId: "human",
			deliveryState: "sent" as const,
			isAgentFinalReply: false,
			replyToSignalId: null,
			wakeSourceSignalId: "my-message",
			wakeTargetProfileIds: ["center"],
		};
		const reply = {
			...message,
			id: "reply",
			actorProfileId: "center",
			isAgentFinalReply: true,
			replyToSignalId: "my-message",
			wakeSourceSignalId: null,
			wakeTargetProfileIds: [],
		};
		const read = (items: Parameters<typeof hasTutorialReply>[0]["items"]) =>
			hasTutorialReply({ items, centerId: "center", profileId: "human" });
		expect(read([reply])).toBe(false);
		expect(read([message, { ...reply, replyToSignalId: "someone-else" }])).toBe(
			false
		);
		expect(read([{ ...message, deliveryState: "pending" }, reply])).toBe(false);
		expect(read([message, { ...reply, isAgentFinalReply: false }])).toBe(false);
		expect(read([{ ...message, wakeTargetProfileIds: [] }, reply])).toBe(false);
		expect(read([message, reply])).toBe(true);
		expect(
			read([
				message,
				{ ...reply, replyToSignalId: null, wakeSourceSignalId: message.id },
			])
		).toBe(true);
	});
});
