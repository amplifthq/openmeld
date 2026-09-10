import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import {
	SpaceDeviceWaitOutcome,
	SpaceDeviceWaitOutcomeScope,
} from "./space-device-wait-outcome";

const source: SpaceTimelineItem = {
	actorAgentControllerRef: null,
	actorAvatarImageUrl: null,
	actorControllerDisplay: null,
	actorName: "Felix",
	actorOwnerDisplay: null,
	actorOwnerName: null,
	actorOwnerUserId: null,
	actorProfileId: "human-1",
	actorProfileKind: "human",
	actorProfileName: "Felix",
	actorRuntimeDeviceDisplayName: null,
	agentControllerConversationId: null,
	agentWorkspace: null,
	attachments: [],
	clientMessageId: "original-client-message",
	createdAtMs: 2,
	deliveryState: "sent",
	id: "original-source",
	newMessagesDuringComposition: null,
	replyPreviewText: null,
	replyToProfileName: null,
	replyToSignalId: null,
	signalType: "signal.text",
	spaceId: "space-1",
	systemNoticeType: null,
	text: "Run this task",
	transientActivityPurpose: null,
	wakeClientMessageId: "original-client-message",
	wakeSourceSignalId: null,
	wakeTargetProfileIds: ["agent-1"],
};
const expired = {
	...source,
	id: "expiry-notice",
	replyToSignalId: source.id,
	systemNoticeType: "terminal_failure",
	systemNoticeReasonCode: "wake.device_wait.expired",
	systemNoticeTargetProfileId: "agent-1",
};

describe("Expired device wait", () => {
	afterEach(cleanup);
	it("offers a new draft anchored to only the expired target, without execution identity", () => {
		const composeAgain = vi.fn();
		render(
			<SpaceDeviceWaitOutcomeScope onComposeAgain={composeAgain}>
				<SpaceDeviceWaitOutcome notices={[expired]} sourceItem={source} />
			</SpaceDeviceWaitOutcomeScope>
		);
		expect(screen.getByText("Wait expired. Task did not run.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Send again" }));
		expect(composeAgain).toHaveBeenCalledExactlyOnceWith({
			sourceSignalId: source.id,
			targetProfileId: "agent-1",
		});
	});
	it.each([
		{ systemNoticeReasonCode: "runtime.local_runtime_lost" },
		{ systemNoticeType: "wake_stopped" },
		{ replyToSignalId: "unrelated-source" },
		{ systemNoticeTargetProfileId: null },
	])("does not offer Send again for ambiguous, interrupted, cancelled, or unrelated work: %j", (change) => {
		render(
			<SpaceDeviceWaitOutcomeScope onComposeAgain={vi.fn()}>
				<SpaceDeviceWaitOutcome
					notices={[{ ...expired, ...change }]}
					sourceItem={source}
				/>
			</SpaceDeviceWaitOutcomeScope>
		);
		expect(screen.queryByRole("button", { name: "Send again" })).toBeNull();
	});
	it("keeps the outcome visible without offering an action in read-only surfaces", () => {
		render(<SpaceDeviceWaitOutcome notices={[expired]} sourceItem={source} />);
		expect(screen.getByText("Wait expired. Task did not run.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Send again" })).toBeNull();
	});
});
