import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_AUTHENTICATED_ENTRY_PATH } from "./auth-entry-policy";
import {
	getCurrentRedirectTarget,
	getFrontendCallbackURLWithRedirect,
	resolvePostAuthRedirect,
	withRedirectQuery,
	withRedirectQueryFromSearch,
} from "./auth-redirect";

describe("auth redirect helpers", () => {
	const originalUrl = window.location.href;

	beforeEach(() => {
		window.history.replaceState({}, "", "http://localhost:3000/login");
	});

	afterEach(() => {
		window.history.replaceState({}, "", originalUrl);
	});

	it("defaults post-auth navigation to the authenticated entry", () => {
		expect(getCurrentRedirectTarget()).toBeNull();
		expect(resolvePostAuthRedirect()).toBe(DEFAULT_AUTHENTICATED_ENTRY_PATH);
	});

	it("keeps an explicit safe redirect target from the current url", () => {
		window.history.replaceState(
			{},
			"",
			"http://localhost:3000/login?redirect=%2Fo%2Facme%2Fspaces%2Fspace-123"
		);

		expect(getCurrentRedirectTarget()).toBe("/o/acme/spaces/space-123");
		expect(resolvePostAuthRedirect()).toBe("/o/acme/spaces/space-123");
	});

	it("keeps the stable Add to Slack funnel entry through authentication", () => {
		window.history.replaceState(
			{},
			"",
			"http://localhost:3000/login?redirect=%2Fadd-to-slack"
		);

		expect(getCurrentRedirectTarget()).toBe("/add-to-slack");
		expect(resolvePostAuthRedirect()).toBe("/add-to-slack");
	});

	it("normalizes a same-origin absolute redirect target from the current url", () => {
		window.history.replaceState(
			{},
			"",
			"http://localhost:3000/login?redirect=http%3A%2F%2Flocalhost%3A3000%2Fdevice%3Fuser_code%3DABC123"
		);

		expect(getCurrentRedirectTarget()).toBe("/device?user_code=ABC123");
		expect(resolvePostAuthRedirect()).toBe("/device?user_code=ABC123");
	});

	it("preserves the join token and auth marker through the login round trip", () => {
		window.history.replaceState(
			{},
			"",
			"http://localhost:3000/login?redirect=%2Fjoin-organization%3Ftoken%3Djoinlink_123%26via%3Dauth"
		);

		expect(resolvePostAuthRedirect()).toBe(
			"/join-organization?token=joinlink_123&via=auth"
		);
	});

	it("preserves the current redirect target when linking across auth routes", () => {
		window.history.replaceState(
			{},
			"",
			"http://localhost:3000/login?redirect=%2Fo%2Facme%2Fspaces%2Fspace-123"
		);

		expect(withRedirectQuery("/sign-up")).toBe(
			"/sign-up?redirect=%2Fo%2Facme%2Fspaces%2Fspace-123"
		);
	});

	it("adds extra search params without dropping the current redirect target", () => {
		window.history.replaceState(
			{},
			"",
			"http://localhost:3000/login?redirect=%2Fo%2Facme%2Fconnect"
		);

		expect(
			withRedirectQuery("/check-email", {
				email: "mira@example.com",
			})
		).toBe(
			"/check-email?redirect=%2Fo%2Facme%2Fconnect&email=mira%40example.com"
		);
	});

	it("keeps the add-account intent through a magic-link callback", () => {
		window.history.replaceState(
			{},
			"",
			"http://localhost:3000/magic-link?intent=add-account&redirect=%2F"
		);

		expect(getFrontendCallbackURLWithRedirect("/magic-link")).toBe(
			"http://localhost:3000/magic-link?redirect=%2F&intent=add-account"
		);
	});

	it("builds the same redirect links from an explicit route search value", () => {
		expect(
			withRedirectQueryFromSearch("/forgot-password", {
				redirect: "/o/acme/connect?returnTo=space&spaceId=space-123",
			})
		).toBe(
			"/forgot-password?redirect=%2Fo%2Facme%2Fconnect%3FreturnTo%3Dspace%26spaceId%3Dspace-123"
		);

		expect(
			withRedirectQueryFromSearch(
				"/check-email",
				"?redirect=%2Fo%2Facme%2Fnew-space",
				{
					email: "mira@example.com",
				}
			)
		).toBe(
			"/check-email?redirect=%2Fo%2Facme%2Fnew-space&email=mira%40example.com"
		);
	});

	it("ignores typed route search values that are not redirect strings", () => {
		expect(
			withRedirectQueryFromSearch("/login", {
				activityPreview: 1,
				redirect: 1,
			})
		).toBe("/login");
	});
});
