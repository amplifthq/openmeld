import { describe, expect, it } from "vitest";
import {
	APP_SIDEBAR_DEFAULT_STATES,
	clampSidebarWidth,
	OUTER_SIDEBAR_DEFAULT_STATE,
	OUTER_SIDEBAR_DEFAULT_WIDTH,
	OUTER_SIDEBAR_MAX_WIDTH,
	OUTER_SIDEBAR_MIN_WIDTH,
	parseSidebarStateCookieValue,
	readAppSidebarStatesFromCookieHeader,
	readSidebarStateFromCookieHeader,
	resolveClientSidebarInitialState,
	SIDEBAR_DEFAULT_STATE,
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	serializeSidebarStateCookieValue,
	writeInnerSidebarStateCookie,
} from "./sidebar-width-cookie";

describe("sidebar-width-cookie", () => {
	it("restores independent page widths from the SSR-readable outer cookie", () => {
		const state = {
			...OUTER_SIDEBAR_DEFAULT_STATE,
			pageWidths: { people: "320px", space: "260px" },
		};
		const restored = readAppSidebarStatesFromCookieHeader(
			`openmeld_sidebar_outer=${encodeURIComponent(serializeSidebarStateCookieValue(state, "outer"))}`
		);
		expect(restored.outer.pageWidths).toEqual(state.pageWidths);
		expect(restored.outer.pageWidths?.agents).toBeUndefined();
	});
	it("clamps a too-wide candidate down to the max", () => {
		expect(clampSidebarWidth("40rem")).toBe(SIDEBAR_MAX_WIDTH);
		expect(clampSidebarWidth("40rem", "outer")).toBe(OUTER_SIDEBAR_MAX_WIDTH);
	});

	it("clamps a too-narrow candidate up to the min", () => {
		expect(clampSidebarWidth("4rem")).toBe(SIDEBAR_MIN_WIDTH);
		expect(clampSidebarWidth("4rem", "outer")).toBe(OUTER_SIDEBAR_MIN_WIDTH);
	});

	it("supports an inner sidebar one third narrower than the previous floor", () => {
		expect(SIDEBAR_MIN_WIDTH).toBe("8rem");
		expect(clampSidebarWidth("8rem")).toBe("8rem");
		expect(clampSidebarWidth("128px")).toBe("128px");
		expect(clampSidebarWidth("7rem")).toBe("8rem");
	});

	it("lets the full app rail stay readable through a narrower desktop band", () => {
		expect(OUTER_SIDEBAR_DEFAULT_WIDTH).toBe("13.75rem");
		expect(OUTER_SIDEBAR_MIN_WIDTH).toBe("10rem");
		expect(OUTER_SIDEBAR_MAX_WIDTH).toBe("24rem");
		expect(clampSidebarWidth("9rem", "outer")).toBe("10rem");
		expect(clampSidebarWidth("147px", "outer")).toBe("160px");
	});

	it("preserves an in-band candidate and its unit", () => {
		expect(clampSidebarWidth("15rem")).toBe("15rem");
		expect(clampSidebarWidth("18rem")).toBe("18rem");
		expect(clampSidebarWidth("240px")).toBe("240px");
	});

	it("falls back to the default for a non-parseable candidate", () => {
		expect(clampSidebarWidth("not-a-width")).toBe(SIDEBAR_DEFAULT_WIDTH);
		expect(clampSidebarWidth("not-a-width", "outer")).toBe(
			OUTER_SIDEBAR_DEFAULT_WIDTH
		);
	});

	it("round-trips state through serialize → parse", () => {
		const state = { tier: "icon" as const, width: "15rem" };
		const parsed = parseSidebarStateCookieValue(
			serializeSidebarStateCookieValue(state)
		);
		expect(parsed).toEqual(state);
	});

	it("round-trips the hidden tier through serialize → parse", () => {
		const state = { tier: "hidden" as const, width: "13.75rem" };
		const parsed = parseSidebarStateCookieValue(
			serializeSidebarStateCookieValue(state, "outer"),
			"outer"
		);
		expect(parsed).toEqual(state);
	});

	it("migrates the retired compact mode to expanded without losing group state", () => {
		expect(parseSidebarStateCookieValue("220px|2|team", "outer")).toEqual({
			tier: "expanded",
			width: "220px",
			collapsedGroupIds: ["team"],
		});
	});

	it("round-trips collapsed group ids in the owning sidebar cookie", () => {
		const state = {
			collapsedGroupIds: ["work", "spaces:pinned"],
			tier: "expanded" as const,
			width: "15rem",
		};

		expect(
			parseSidebarStateCookieValue(serializeSidebarStateCookieValue(state))
		).toEqual(state);
	});

	it("ignores malformed and duplicate persisted group ids", () => {
		expect(
			parseSidebarStateCookieValue("15rem|0|work,work,bad%20id,team")
		).toEqual({
			collapsedGroupIds: ["work", "team"],
			tier: "expanded",
			width: "15rem",
		});
	});

	it("defaults on an absent or malformed cookie value", () => {
		expect(parseSidebarStateCookieValue(null)).toEqual(SIDEBAR_DEFAULT_STATE);
		expect(parseSidebarStateCookieValue("")).toEqual(SIDEBAR_DEFAULT_STATE);
		expect(parseSidebarStateCookieValue(null, "outer")).toEqual(
			OUTER_SIDEBAR_DEFAULT_STATE
		);
		// New users get the most informative outer rail until they choose otherwise.
		expect(parseSidebarStateCookieValue(null, "outer").tier).toBe("expanded");
		expect(parseSidebarStateCookieValue("garbage")).toEqual({
			tier: "expanded",
			width: SIDEBAR_DEFAULT_WIDTH,
		});
	});

	// A cookie written before the compact tier existed only ever contains the
	// old two-symbol alphabet ("0" = not collapsed, "1" = collapsed). These
	// must keep parsing correctly under the new three-symbol parser with no
	// version bump and no migration step.
	describe("back-compat with pre-compact-tier cookies", () => {
		it("parses an old collapsed=false cookie ('0') as the full tier", () => {
			expect(parseSidebarStateCookieValue("18rem|0")).toEqual({
				tier: "expanded",
				width: "18rem",
			});
		});

		it("parses an old collapsed=true cookie ('1') as the collapsed tier", () => {
			expect(parseSidebarStateCookieValue("9rem|1", "outer")).toEqual({
				tier: "icon",
				width: "10rem",
			});
		});
	});

	it("reads + parses the persisted state from a Cookie request header (SSR path)", () => {
		const header = `theme=dark; openmeld_sidebar_inner=${encodeURIComponent(
			serializeSidebarStateCookieValue({ tier: "expanded", width: "16rem" })
		)}; other=1`;
		expect(readSidebarStateFromCookieHeader(header)).toEqual({
			tier: "expanded",
			width: "16rem",
		});
	});

	it("reads both app sidebar states from scoped Cookie request keys", () => {
		const header = `openmeld_sidebar_outer=${encodeURIComponent(
			serializeSidebarStateCookieValue({ tier: "icon", width: "9rem" }, "outer")
		)}; openmeld_sidebar_inner=${encodeURIComponent(
			serializeSidebarStateCookieValue({ tier: "expanded", width: "15rem" })
		)}`;

		expect(readAppSidebarStatesFromCookieHeader(header)).toEqual({
			inner: { tier: "expanded", width: "15rem" },
			outer: { tier: "icon", width: "10rem" },
		});
	});

	it("restores independent inner widths for each page family", () => {
		const header = `openmeld_sidebar_inner=${encodeURIComponent(
			serializeSidebarStateCookieValue({ tier: "expanded", width: "14rem" })
		)}; openmeld_sidebar_inner_center_agent=${encodeURIComponent(
			serializeSidebarStateCookieValue({ tier: "expanded", width: "18rem" })
		)}; openmeld_sidebar_inner_spaces=${encodeURIComponent(
			serializeSidebarStateCookieValue({ tier: "expanded", width: "12rem" })
		)}`;

		expect(
			readAppSidebarStatesFromCookieHeader(header, "center-agent").inner
		).toEqual({ tier: "expanded", width: "18rem" });
		expect(
			readAppSidebarStatesFromCookieHeader(header, "spaces").inner
		).toEqual({ tier: "expanded", width: "12rem" });
		expect(
			readAppSidebarStatesFromCookieHeader(header, "agent-activity").inner
		).toEqual({ tier: "expanded", width: "14rem" });
	});

	it("writes only the selected page family's inner width", () => {
		writeInnerSidebarStateCookie("center-agent", {
			tier: "expanded",
			width: "18rem",
		});
		writeInnerSidebarStateCookie("spaces", {
			tier: "expanded",
			width: "12rem",
		});

		try {
			expect(
				readAppSidebarStatesFromCookieHeader(document.cookie, "center-agent")
					.inner
			).toEqual({ tier: "expanded", width: "18rem" });
			expect(
				readAppSidebarStatesFromCookieHeader(document.cookie, "spaces").inner
			).toEqual({ tier: "expanded", width: "12rem" });
		} finally {
			// biome-ignore lint/suspicious/noDocumentCookie: test cleanup for the browser cookies set above.
			document.cookie =
				"openmeld_sidebar_inner_center_agent=; Max-Age=0; Path=/";
			// biome-ignore lint/suspicious/noDocumentCookie: test cleanup for the browser cookies set above.
			document.cookie = "openmeld_sidebar_inner_spaces=; Max-Age=0; Path=/";
		}
	});

	it("does not read retired ATS sidebar cookies", () => {
		const legacyHeader = `ats_sidebar=${encodeURIComponent(
			serializeSidebarStateCookieValue({ tier: "icon", width: "20rem" })
		)}; ats_sidebar_inner=${encodeURIComponent(
			serializeSidebarStateCookieValue({ tier: "expanded", width: "16rem" })
		)}; ats_sidebar_outer=${encodeURIComponent(
			serializeSidebarStateCookieValue({ tier: "icon", width: "9rem" }, "outer")
		)}`;

		expect(readAppSidebarStatesFromCookieHeader(legacyHeader)).toEqual(
			APP_SIDEBAR_DEFAULT_STATES
		);
	});

	it("prefers the client sidebar cookie over a stale route-loader outer state", () => {
		// biome-ignore lint/suspicious/noDocumentCookie: test sets the browser cookie that the production helper reads.
		document.cookie = `openmeld_sidebar_outer=${encodeURIComponent(
			serializeSidebarStateCookieValue(
				{ tier: "expanded", width: "9rem" },
				"outer"
			)
		)}; Path=/`;

		try {
			expect(
				resolveClientSidebarInitialState("outer", {
					tier: "icon",
					width: "9rem",
				})
			).toEqual({ tier: "expanded", width: "10rem" });
		} finally {
			// biome-ignore lint/suspicious/noDocumentCookie: test cleanup for the browser cookie set above.
			document.cookie = "openmeld_sidebar_outer=; Max-Age=0; Path=/";
		}
	});

	it("returns the default state when no sidebar cookie is present", () => {
		expect(readSidebarStateFromCookieHeader("theme=dark")).toEqual(
			SIDEBAR_DEFAULT_STATE
		);
		expect(readSidebarStateFromCookieHeader(null)).toEqual(
			SIDEBAR_DEFAULT_STATE
		);
	});
});
