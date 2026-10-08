import { BroadcastChannel as NativeBroadcastChannel } from "node:worker_threads";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";
import {
	publishAgentAvatarInvalidation,
	subscribeAgentAvatarInvalidations,
} from "./agent-avatar-invalidation";

afterEach(() => vi.unstubAllGlobals());
const PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const scope = { ownerAccountId: "owner", organizationId: "org-1" };

describe("Agent avatar refresh signals", () => {
	it("ignores malformed, wrong-scope and unrelated-Profile messages without applying incoming identity data", async () => {
		vi.stubGlobal("BroadcastChannel", NativeBroadcastChannel);
		const client = new QueryClient();
		const key = organizationQueryKeys.profileDirectory("org-1");
		const original = {
			agentProfiles: [{ profileId: PROFILE_ID, avatarStyle: "clover" }],
		};
		client.setQueryData(key, original);
		client.setQueryData(
			startQueryKeys.profilesForStorageScope("other-account"),
			[]
		);
		const stop = subscribeAgentAvatarInvalidations({
			...scope,
			queryClient: client,
		});
		const channel = new NativeBroadcastChannel(
			"openmeld.agent-avatar-invalidation.v1"
		);
		const valid = {
			...scope,
			type: "agent.avatar.changed" as const,
			profileId: PROFILE_ID,
		};
		const invalidations = vi.spyOn(client, "invalidateQueries");
		try {
			channel.postMessage({ ...valid, avatarStyle: "flower" });
			channel.postMessage({ ...valid, ownerAccountId: "other-account" });
			channel.postMessage({ ...valid, organizationId: "org-2" });
			channel.postMessage({
				...valid,
				profileId: "agt_22222222-2222-4222-8222-222222222222",
			});
			// A later valid message is the barrier for the earlier messages on this channel.
			channel.postMessage(valid);
			await vi.waitFor(() =>
				expect(client.getQueryState(key)?.isInvalidated).toBe(true)
			);
			expect(client.getQueryData(key)).toEqual(original);
			expect(
				client.getQueryState(
					startQueryKeys.profilesForStorageScope("other-account")
				)?.isInvalidated
			).toBe(false);
			expect(invalidations).toHaveBeenCalledTimes(3);
		} finally {
			stop();
			channel.close();
		}
	});

	it("does not turn an unavailable browser channel into a failed save", () => {
		vi.stubGlobal("BroadcastChannel", undefined);
		expect(() =>
			publishAgentAvatarInvalidation({
				...scope,
				type: "agent.avatar.changed",
				profileId: PROFILE_ID,
			})
		).not.toThrow();
		expect(() =>
			subscribeAgentAvatarInvalidations({
				...scope,
				queryClient: new QueryClient(),
			})()
		).not.toThrow();
	});
});
