import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	activateCenterAgentPendingMessageScope,
	clearCenterAgentPendingMessage,
	readCenterAgentPendingMessage,
	writeCenterAgentPendingMessage,
} from "./center-agent-pending-message";

const pendingMessage = {
	clientMessageId: "client-message-acme",
	createdAtMs: 1_751_000_000_000,
	text: "Plan the launch",
} as const;

describe("Center Agent pending message scope", () => {
	it("preserves a route-pending message when the same slug resolves to its organization id", () => {
		const queryClient = new QueryClient();
		const pendingRouteScope = { organizationSlug: "acme" };
		const resolvedScope = {
			organizationId: "org-acme",
			organizationSlug: "acme",
		};

		activateCenterAgentPendingMessageScope(queryClient, pendingRouteScope);
		writeCenterAgentPendingMessage(
			queryClient,
			pendingRouteScope,
			pendingMessage
		);
		activateCenterAgentPendingMessageScope(queryClient, resolvedScope);

		expect(readCenterAgentPendingMessage(queryClient, resolvedScope)).toEqual(
			pendingMessage
		);
		expect(
			readCenterAgentPendingMessage(queryClient, pendingRouteScope)
		).toEqual(pendingMessage);
	});

	it("discards the old pending message when the organization changes", () => {
		const queryClient = new QueryClient();
		const acmeScope = {
			organizationId: "org-acme",
			organizationSlug: "acme",
		};
		const betaScope = {
			organizationId: "org-beta",
			organizationSlug: "beta",
		};

		activateCenterAgentPendingMessageScope(queryClient, acmeScope);
		writeCenterAgentPendingMessage(queryClient, acmeScope, pendingMessage);
		activateCenterAgentPendingMessageScope(queryClient, betaScope);

		expect(readCenterAgentPendingMessage(queryClient, acmeScope)).toBeNull();
		expect(readCenterAgentPendingMessage(queryClient, betaScope)).toBeNull();
	});

	it("does not resurrect a slug-scoped message after the resolved scope clears it", () => {
		const queryClient = new QueryClient();
		const pendingRouteScope = { organizationSlug: "acme" };
		const resolvedScope = {
			organizationId: "org-acme",
			organizationSlug: "acme",
		};

		writeCenterAgentPendingMessage(
			queryClient,
			pendingRouteScope,
			pendingMessage
		);
		activateCenterAgentPendingMessageScope(queryClient, resolvedScope);
		clearCenterAgentPendingMessage(queryClient, resolvedScope);

		expect(
			readCenterAgentPendingMessage(queryClient, pendingRouteScope)
		).toBeNull();
	});
});
