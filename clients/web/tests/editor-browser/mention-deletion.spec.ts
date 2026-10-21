import { expect, type Page, test } from "@playwright/test";

const RUNNER_OPTION = /Runner/;

// A restored Agent draft, as the walkthrough and draft restore create it.
async function openAgentDraft(page: Page, query = "") {
	const errors: Error[] = [];
	page.on("pageerror", (error) => errors.push(error));
	await page.goto(`/${query}`);
	const editor = page.getByRole("textbox", { name: "Message", exact: true });
	await editor.click();
	await page.evaluate(() => window.replaceDraft(""));
	await page.evaluate(() => window.restoreAgentDraft("Hi"));
	await editor.click();
	await editor.press("End");
	const token = editor.getByTestId("space-composer-profile-token");
	await expect(token).toHaveCount(1);
	return { editor, errors, token };
}

function expectNoMention(page: Page) {
	return expect(page.getByTestId("mentions")).toHaveText("[]");
}

test("holding Backspace removes the whole Agent mention and the editor keeps working", async ({
	page,
}) => {
	const { errors, token } = await openAgentDraft(page, "?wake");
	for (const _ of "Hi ") {
		await page.keyboard.press("Backspace");
	}
	await expect(page.getByTestId("draft")).toHaveText("@Runner");
	await expect(token).toHaveCount(1);
	// One more Backspace reaches the mention. Extra presses hit an empty draft.
	for (let index = 0; index < 20; index += 1) {
		await page.keyboard.press("Backspace");
	}
	await expect(page.getByTestId("draft")).toHaveText("");
	await expectNoMention(page);
	await expect(token).toHaveCount(0);
	await page.keyboard.type("@Run");
	await expect(page.getByRole("option", { name: RUNNER_OPTION })).toBeVisible();
	expect(errors).toEqual([]);
});

test("Delete removes the whole Agent mention from the start of the draft", async ({
	page,
}) => {
	const { errors, token } = await openAgentDraft(page);
	await page.evaluate(() => window.selectEditor(0, 0));
	await page.keyboard.press("Delete");
	await expect(token).toHaveCount(0);
	await expectNoMention(page);
	await expect(page.getByTestId("draft")).toHaveText(" Hi");
	await page.keyboard.insertText("x");
	await expect(page.getByTestId("draft")).toHaveText("x Hi");
	expect(errors).toEqual([]);
});

test("select all, Backspace and undo restore the Agent mention", async ({
	page,
}) => {
	const { editor, errors, token } = await openAgentDraft(page);
	await editor.evaluate((element) =>
		getSelection()?.selectAllChildren(element)
	);
	// Slate adopts a scripted selection on its throttled selectionchange handler.
	await page.waitForTimeout(200);
	await page.keyboard.press("Backspace");
	await expect(page.getByTestId("draft")).toHaveText("");
	await expect(token).toHaveCount(0);
	await page.keyboard.press("ControlOrMeta+z");
	await expect(page.getByTestId("draft")).toHaveText("@Runner Hi");
	await expect(token).toHaveCount(1);
	await expect(page.getByTestId("mentions")).toContainText('"relation":"wake"');
	await page.evaluate(() => window.selectEditor(10, 10));
	await page.keyboard.insertText("!");
	await expect(page.getByTestId("draft")).toHaveText("@Runner Hi!");
	expect(errors).toEqual([]);
});

test("undo after Backspace into the Agent mention restores it", async ({
	page,
}) => {
	const { errors, token } = await openAgentDraft(page);
	await page.evaluate(() => window.selectEditor(8, 8));
	await page.keyboard.press("Backspace");
	await page.keyboard.press("Backspace");
	await expect(token).toHaveCount(0);
	await expectNoMention(page);
	await expect(page.getByTestId("draft")).toHaveText("Hi");
	await page.keyboard.press("ControlOrMeta+z");
	await page.keyboard.press("ControlOrMeta+z");
	await expect(token).toHaveCount(1);
	await expect(page.getByTestId("draft")).toHaveText("@Runner Hi");
	await page.keyboard.insertText("x");
	await expect(page.getByTestId("draft")).toHaveText("@Runner xHi");
	expect(errors).toEqual([]);
});
