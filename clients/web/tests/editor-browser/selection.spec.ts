import { expect, test } from "@playwright/test";

const FELIX_OPTION = /Felix/;

test("the first native selection also survives a refresh before Slate receives it", async ({
	page,
}) => {
	await page.goto("/");
	const editor = page.getByRole("textbox", { name: "Message", exact: true });
	await editor.evaluate((element) => {
		(element as HTMLElement).focus();
		const text = element.querySelector("[data-slate-string]")?.firstChild;
		const selection = getSelection();
		if (!(text && selection)) {
			throw new Error("Missing native text selection");
		}
		selection.setBaseAndExtent(text, 6, text, 6);
		window.refreshEditor();
	});
	await page.keyboard.insertText("X");
	await expect(page.getByTestId("draft")).toHaveText(
		"alpha Xbravo charlie delta"
	);
});

for (const surface of ["composer", "document"]) {
	for (const range of [
		{ anchor: 6, focus: 6, expected: "alpha Xbravo charlie delta" },
		{ anchor: 11, focus: 6, expected: "alpha X charlie delta" },
	]) {
		test(`${surface}: refresh preserves native range ${range.anchor}-${range.focus} and next insertion`, async ({
			page,
		}) => {
			page.on("pageerror", (error) => {
				throw error;
			});
			await page.goto(surface === "document" ? "/?document" : "/");
			const editor = page.getByRole("textbox", {
				name: "Message",
				exact: true,
			});
			await editor.click();
			await editor.press("End");
			await expect
				.poll(() => editor.evaluate(() => getSelection()?.anchorOffset))
				.toBe(25);
			// Move the real browser selection and synchronously deliver a parent refresh
			// before the browser dispatches selectionchange (no timer race in the test).
			await editor.evaluate((element, range) => {
				const text = element.querySelector("[data-slate-string]")?.firstChild;
				const selection = getSelection();
				if (!(text && selection)) {
					throw new Error("Missing native text selection");
				}
				selection.setBaseAndExtent(text, range.anchor, text, range.focus);
				window.refreshEditor();
			}, range);
			await expect
				.poll(() =>
					editor.evaluate(() => [
						getSelection()?.anchorOffset,
						getSelection()?.focusOffset,
					])
				)
				.toEqual([range.anchor, range.focus]);
			await page.keyboard.insertText("X");
			await expect(page.getByTestId("draft")).toHaveText(range.expected);
		});
	}
}

test("native clicks, arrows, mention, paste and draft restoration survive snapshot updates", async ({
	page,
}) => {
	page.on("pageerror", (error) => {
		throw error;
	});
	await page.goto("/");
	const editor = page.getByRole("textbox", { name: "Message", exact: true });
	await editor.click();
	await page.evaluate(() => window.selectEditor(6, 6));
	await editor.press("ArrowRight");
	await page.evaluate(() => window.refreshEditor());
	await page.keyboard.insertText("X");
	await expect(page.getByTestId("draft")).toHaveText(
		"alpha bXravo charlie delta"
	);
	await page.evaluate(() => window.replaceDraft(""));
	await editor.pressSequentially("@Fel");
	await page.getByRole("option", { name: FELIX_OPTION }).click();
	await expect(page.getByTestId("mentions")).toContainText(
		'"relation":"mention"'
	);
	await editor.evaluate((element) => {
		const clipboardData = new DataTransfer();
		clipboardData.setData("text/plain", "first line\n中文粘贴");
		element.dispatchEvent(
			new ClipboardEvent("paste", {
				bubbles: true,
				cancelable: true,
				clipboardData,
			})
		);
	});
	await expect(page.getByTestId("draft")).toContainText("中文粘贴");
	await page.reload();
	await expect(editor).toContainText("中文粘贴");
	await expect(page.getByTestId("mentions")).toContainText(
		'"relation":"mention"'
	);
	await page.getByRole("textbox", { name: "Other control" }).click();
	await page.evaluate(() => {
		window.replaceDraft("Restored text");
		window.refreshEditor();
	});
	await expect(
		page.getByRole("textbox", { name: "Other control" })
	).toBeFocused();
	await editor.click();
	await page.evaluate(() => window.replaceDraft("New draft"));
	await page.keyboard.insertText("!");
	await expect(page.getByTestId("draft")).toHaveText("New draft!");
});

test("Chinese composition survives a refresh without sending or duplicating text", async ({
	page,
	browserName,
}) => {
	test.skip(
		browserName !== "chromium",
		"CDP composition is Chromium-only; native IME acceptance: https://github.com/amplifthq/openmeld/issues/1397"
	);
	await page.goto("/");
	const editor = page.getByRole("textbox", { name: "Message", exact: true });
	await editor.click();
	await page.evaluate(() => window.replaceDraft(""));
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Input.imeSetComposition", {
		text: "中文",
		selectionStart: 2,
		selectionEnd: 2,
	});
	await page.evaluate(() => window.refreshEditor());
	await cdp.send("Input.insertText", { text: "中文" });
	await expect(page.getByTestId("draft")).toHaveText("中文");
	await expect(page.getByTestId("sent")).toHaveText("0");
	await page.keyboard.insertText("输入");
	await expect(page.getByTestId("draft")).toHaveText("中文输入");
});

test("decoration node splits still restore the editor selection", async ({
	page,
}) => {
	await page.goto("/?decorated");
	const editor = page.getByRole("textbox", { name: "Message", exact: true });
	await editor.click();
	await editor.press("End");
	await page.evaluate(() => window.refreshEditor());
	await expect(editor.locator("[data-slate-string]")).toHaveCount(2);
	await page.keyboard.insertText("!");
	await expect(page.getByTestId("draft")).toHaveText(
		"alpha bravo charlie delta!"
	);
});

test("a native pointer click keeps its new caret during the next animation frame refresh", async ({
	page,
}) => {
	await page.goto("/");
	const editor = page.getByRole("textbox", { name: "Message", exact: true });
	await editor.click();
	await editor.press("End");
	const point = await editor.evaluate((element) => {
		const range = document.createRange();
		const text = element.querySelector("[data-slate-string]")?.firstChild;
		if (!text) {
			throw new Error("Missing editor text");
		}
		range.setStart(text, 6);
		range.setEnd(text, 7);
		const bounds = range.getBoundingClientRect();
		element.addEventListener(
			"pointerdown",
			() => requestAnimationFrame(() => window.refreshEditor()),
			{ once: true }
		);
		return { x: bounds.x + 1, y: bounds.y + bounds.height / 2 };
	});
	await page.mouse.click(point.x, point.y);
	await expect(page.getByTestId("revision")).toHaveText("1");
	await page.keyboard.insertText("X");
	await expect(page.getByTestId("draft")).toHaveText(
		"alpha Xbravo charlie delta"
	);
});
