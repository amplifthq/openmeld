import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// Replays the real-browser parts of legacy sidebar cases S20, S29, and S32.
// Start the fictional-data preview first; this never uses a signed-in account.
test("conversation sidebar S20/S29/S32 browser geometry", () => {
	const url = new URL(process.argv[2] ?? "http://127.0.0.1:30182/?layout");
	assert(["localhost", "127.0.0.1"].includes(url.hostname));
	url.searchParams.set("layout", "");
	const session = `conversation-layout-${process.pid}`;
	const chrome =
		process.env.AGENT_BROWSER_EXECUTABLE_PATH ??
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
	const output = path.resolve("dev-tmp/conversation-layout");
	mkdirSync(output, { recursive: true });
	const run = (...args) =>
		execFileSync("agent-browser", ["--session", session, ...args], {
			encoding: "utf8",
			timeout: 30_000,
		});
	const inspect = (expression) => JSON.parse(run("eval", expression));
	const link = 'a[data-sidebar="menu-button"][href="/o/test/spaces/design"]';
	const pin =
		'button[aria-label="Pin Product design and release coordination"]';
	const activity = `li:has(${link}) [data-conversation-activity]`;
	const measure = `(() => {
  const link = document.querySelector('${link}');
  const title = link.querySelector('[data-conversation-title]');
  const activity = link.closest('li').querySelector('[data-conversation-activity]');
  const actions = link.closest('li').querySelector('[data-sidebar="menu-actions"]');
  const rect = (node) => { const r=node.getBoundingClientRect(); return {left:r.left,right:r.right,width:r.width,top:r.top,bottom:r.bottom}; };
  return {row:rect(link),title:rect(title),activity:rect(activity),actions:rect(actions),actionOpacity:Number(getComputedStyle(actions).opacity),activityDisplay:getComputedStyle(activity).display,overflow:document.documentElement.scrollWidth-innerWidth};
})()`;

	try {
		run(
			...(existsSync(chrome) ? ["--executable-path", chrome] : []),
			"open",
			url.href
		);
		run("wait", "[data-conversation-activity]");
		run("set", "viewport", "1440", "900");
		for (const width of [180, 220, 320]) {
			run("fill", '[aria-label="Sidebar width"]', String(width));
			run("hover", '[aria-label="Sidebar width"]');
			run("wait", "200");
			const rest = inspect(measure);
			assert(rest.title.width > 0, `S20: title disappeared at ${width}px`);
			assert(
				rest.actionOpacity < 0.1,
				`S32: hidden actions reserve a visible cluster at ${width}px`
			);
			// Enter over the stable leading icon. The row's geometric center may
			// belong to its separately clickable trailing controls at narrow widths.
			run("hover", `${link} svg[aria-label="Space"]`);
			run("wait", "200");
			const hover = inspect(measure);
			assert(
				Math.abs(hover.activity.left - rest.activity.left) < 1,
				`S29: activity moved ${(hover.activity.left - rest.activity.left).toFixed(1)}px when the pointer entered the row at ${width}px`
			);
			assert(
				hover.actionOpacity > 0.9,
				`S29: pin is not visible on hover at ${width}px`
			);
			assert(
				hover.title.width > 0 && hover.title.width < rest.title.width,
				`S32: title does not yield room to actions at ${width}px`
			);
			assert(
				hover.actions.right <= hover.activity.left + 1,
				`S29: activity overlaps actions at ${width}px`
			);
			assert(
				hover.title.right <= hover.actions.left + 1,
				`S20: title overlaps activity at ${width}px`
			);
			assert(
				hover.actions.right <= hover.row.right + 1,
				`S20: actions overflow the row at ${width}px`
			);
			run("focus", pin);
			run("hover", '[aria-label="Sidebar width"]');
			run("wait", "200");
			const focus = inspect(measure);
			assert(
				focus.actionOpacity > 0.9 && focus.activityDisplay !== "none",
				`S29: keyboard focus hides status/actions at ${width}px`
			);
			assert(
				focus.actions.right <= focus.activity.left + 1,
				`S29: focused actions overlap activity at ${width}px`
			);
			run("screenshot", path.join(output, `sidebar-${width}.png`));
			console.log(
				`PASS S20/S29/S32 width=${width}: title ${rest.title.width.toFixed(1)}→${hover.title.width.toFixed(1)}, activity/action gap ${(hover.activity.left - hover.actions.right).toFixed(1)}`
			);
		}
		run("set", "viewport", "320", "800");
		run("fill", '[aria-label="Sidebar width"]', "288");
		assert(
			inspect(measure).overflow <= 0,
			"S20: horizontal overflow at mobile width"
		);
		run("press", "Escape");
		run("hover", '[aria-label="Sidebar width"]');
		run("wait", "200");
		run("hover", activity);
		run("wait", "200");
		assert(
			inspect(
				`Array.from(document.querySelectorAll('[data-slot="tooltip-content"][data-open]')).some(node => node.textContent.includes('Review Agent is working'))`
			),
			"S21: activity tooltip is unavailable on hover"
		);
		run("screenshot", path.join(output, "sidebar-mobile.png"));
		assert.equal(run("errors").trim(), "", "Browser reported a page error");
		console.log("PASS mobile overflow, activity tooltip, and browser errors");
	} finally {
		run("close");
	}
});
