import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Manual, isolated browser acceptance; not a production entry or a CI prerequisite.
test("Desktop updater synthetic visual acceptance", () => {
	const root = fileURLToPath(new URL("../../../../", import.meta.url));
	const origin = new URL(process.argv[2] ?? "http://127.0.0.1:4176");
	assert.equal(origin.protocol, "http:");
	assert.ok(["127.0.0.1", "localhost"].includes(origin.hostname));
	const directory = path.join(root, "dev-tmp/pr1160-visual");
	mkdirSync(directory, { recursive: true });
	const env = {
		...process.env,
		AGENT_BROWSER_SESSION: `pr1160-capture-${randomUUID()}`,
	};
	function browser(...args) {
		const response = JSON.parse(
			execFileSync("agent-browser", [...args, "--json"], {
				cwd: root,
				env,
				encoding: "utf8",
				timeout: 45_000,
				maxBuffer: 2 * 1024 * 1024,
			})
		);
		assert.ok(response.success, JSON.stringify(response));
		return response.data.result ?? response.data;
	}
	let viewport = [1280, 800];
	function setViewport(width, height) {
		viewport = [width, height];
		browser("set", "viewport", String(width), String(height));
	}
	function settle() {
		browser(
			"eval",
			"(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>undefined)));return true;})()"
		);
	}
	function open(state, theme, mode, extra = "") {
		browser(
			"open",
			`${origin}?state=${state}&theme=${theme}&mode=${mode}${extra}`
		);
		let status = state;
		if (extra.includes("web") || extra.includes("read-error")) {
			status = "unknown";
		} else if (state.includes("error")) {
			status = "error";
		} else if (["indeterminate", "verifying"].includes(state)) {
			status = "downloading";
		}
		// Wait for the real component's native snapshot, not only loaded fonts/HTML.
		browser("wait", `[data-fixture-status="${status}"]`);
		browser("set", "viewport", ...viewport.map(String));
		settle();
		assert.deepEqual(browser("eval", "[innerWidth,innerHeight]"), viewport);
	}
	function screenshot(name) {
		browser("screenshot", path.join(directory, `${name}.png`));
	}
	const measure = `(() => {
 const boxes = s => Array.from(document.querySelectorAll(s)).map(e => {
  const r=e.getBoundingClientRect(), c=getComputedStyle(e);
  return {text:e.textContent.trim(),x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom,scroll:e.scrollWidth,client:e.clientWidth,color:c.color,bg:c.backgroundColor};
 });
 return {viewport:[innerWidth,innerHeight],overflow:document.documentElement.scrollWidth>innerWidth,inert:document.body.inert,headings:boxes('h1,h2'),status:boxes('[data-slot="desktop-update-status"]'),actions:boxes('[data-slot="desktop-update-action"]'),buttons:boxes('button'),notice:boxes('aside[aria-label="Desktop update"]'),dots:boxes('[data-slot="desktop-update-indicator"]'),progress:Array.from(document.querySelectorAll('[role="progressbar"]')).map(e=>({now:e.getAttribute('aria-valuenow'),text:e.getAttribute('aria-valuetext')}))};
})()`;
	const settings = [
		"unknown",
		"idle",
		"checking",
		"current",
		"available",
		"downloading",
		"indeterminate",
		"verifying",
		"downloaded",
		"preparing",
		"installing",
		"unavailable",
		"check-error",
		"unknown-error",
		"download-error",
		"restart-error",
		"install-error",
	];
	const notices = [
		"available",
		"downloading",
		"downloaded",
		"download-error",
		"restart-error",
		"preparing",
		"installing",
		"install-error",
	];
	function checkGeometry(result, name, mode, width) {
		assert.equal(result.overflow, false, name);
		for (const button of result.buttons) {
			assert.ok(
				button.scroll <= button.client + 1,
				`${name}: clipped ${button.text}`
			);
		}
		if (mode === "settings" && result.actions.length && width === 1280) {
			assert.ok(
				result.actions[0].x > result.status[0].x + result.status[0].w / 2,
				`${name}: primary action must be right aligned`
			);
		}
		if (mode === "notice") {
			assert.equal(
				result.notice.length,
				1,
				`${name}: expected a visible update notice`
			);
			const labels = [
				"Download update",
				"Restart to update",
				"Retry download",
				"Retry restart",
			];
			for (const button of result.buttons.filter((b) =>
				labels.includes(b.text)
			)) {
				assert.ok(
					Math.abs(button.w - (result.notice[0].w - 32)) < 2,
					`${name}: full-content-width action`
				);
			}
		}
	}
	function captureState(state, theme, mode, width) {
		open(state, theme, mode);
		const name = `${mode}-${state}-${theme}-${width}`;
		const result = browser("eval", measure);
		checkGeometry(result, name, mode, width);
		if (state === "verifying") {
			assert.ok(
				!result.buttons.some((b) => b.text === "Restart to update"),
				name
			);
		}
		if (state === "indeterminate") {
			assert.equal(result.progress[0].now, null, name);
		}
		if (
			["preparing", "installing", "install-error", "unknown"].includes(state)
		) {
			assert.equal(result.inert, true, name);
		}
		screenshot(name);
		captures.push({
			name,
			state,
			theme,
			mode,
			source: "synthetic bridge; production components",
			...result,
		});
	}
	const captures = [];
	const interactions = [];
	function captureMatrix() {
		for (const [width, height] of [
			[1280, 800],
			[375, 812],
		]) {
			setViewport(width, height);
			for (const theme of ["light", "dark"]) {
				for (const [mode, states] of [
					["settings", settings],
					["notice", notices],
				]) {
					for (const state of states) {
						captureState(state, theme, mode, width);
					}
				}
				console.log(
					`Captured ${width} ${theme}: ${captures.length} state images`
				);
			}
		}
	}
	try {
		captureMatrix();
		for (const theme of ["light", "dark"]) {
			setViewport(1280, 800);
			open("available", theme, "notice");
			browser("click", "input");
			browser("fill", "input", "Keep this draft");
			assert.equal(browser("eval", "document.activeElement.tagName"), "INPUT");
			browser(
				"eval",
				"window.updaterFixture.emit(window.updaterFixture.cases.downloading)"
			);
			browser("wait", '[data-fixture-status="downloading"]');
			assert.equal(browser("eval", "document.activeElement.tagName"), "INPUT");
			const laterColor =
				"getComputedStyle(Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Later')).color";
			const restingColor = browser("eval", laterColor);
			browser(
				"hover",
				'aside[aria-label="Desktop update"] section > div:first-child > button'
			);
			settle();
			const hoverColor = browser("eval", laterColor);
			browser("hover", "input");
			browser("click", "input");
			for (let i = 0; i < 8; i++) {
				browser("press", "Tab");
				if (
					browser("eval", "document.activeElement.textContent.trim()") ===
					"Later"
				) {
					break;
				}
			}
			settle();
			assert.notEqual(restingColor, hoverColor);
			const focus = browser(
				"eval",
				"({label:document.activeElement.textContent.trim(),visible:document.activeElement.matches(':focus-visible'),color:getComputedStyle(document.activeElement).color,shadow:getComputedStyle(document.activeElement).boxShadow})"
			);
			assert.equal(focus.label, "Later");
			assert.ok(focus.visible && focus.color !== restingColor);
			screenshot(`notice-later-focus-${theme}-1280`);
			browser("press", "Enter");
			assert.equal(browser("eval", "window.updaterFixture.actions.length"), 0);
			assert.equal(
				browser(
					"eval",
					"document.querySelectorAll('aside[aria-label=\"Desktop update\"]').length"
				),
				0
			);
			interactions.push({
				theme,
				focus,
				restingColor,
				hoverColor,
				noFocusTheft: true,
				dismissalWithoutNativeAction: true,
			});
			for (const [width, height] of [
				[1280, 800],
				[375, 812],
			]) {
				setViewport(width, height);
				open("available", theme, "dialog");
				browser("wait", '[role="dialog"]');
				assert.equal(
					browser(
						"eval",
						"document.querySelectorAll('aside[aria-label=\"Desktop update\"]').length"
					),
					0
				);
				screenshot(`dialog-available-${theme}-${width}`);
			}
			open("available", theme, "settings", "&reject");
			browser("click", '[data-slot="desktop-update-action"] button');
			browser("wait", '[role="alert"]');
			screenshot(`settings-transport-error-${theme}-375`);
			open("available", theme, "notice", "&web");
			assert.equal(
				browser(
					"eval",
					"document.querySelectorAll('[data-slot=desktop-update-indicator]').length"
				),
				0
			);
			assert.equal(browser("eval", "document.body.inert"), false);
			assert.equal(browser("eval", "window.updaterFixture.actions.length"), 0);
		}
		writeFileSync(
			path.join(directory, "verified-measurements.json"),
			JSON.stringify({ captures, interactions }, null, 2)
		);
		console.log(
			`PASS: ${captures.length} state captures, keyboard/focus, dialog, IPC rejection, and plain Web boundaries.`
		);
	} finally {
		// This script owns only its unique browser session; never close other sessions.
		browser("close");
	}
});
