import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MessageResponse } from "./message-response";

afterEach(cleanup);

describe("reasoning Markdown", () => {
	it("renders basic formatting and unfinished code without rich code controls", () => {
		const { container, rerender } = render(
			<MessageResponse isStreaming variant="reasoning">
				{
					"**Inspecting**\n\n- Read `state`\n- Check events\n\n```ts\nconst active = true;"
				}
			</MessageResponse>
		);
		expect(container.querySelector("strong")?.textContent).toBe("Inspecting");
		expect(container.querySelectorAll("li")).toHaveLength(2);
		expect(container.querySelector("pre code")?.textContent).toContain(
			"const active = true;"
		);
		expect(container.querySelector("button")).toBeNull();
		rerender(
			<MessageResponse variant="reasoning">
				{"**Inspected**\n\n```ts\nconst active = false;\n```"}
			</MessageResponse>
		);
		expect(container.querySelector("strong")?.textContent).toBe("Inspected");
		expect(container.querySelector("pre code")?.textContent).toContain("false");
	});

	it("reuses message safety for raw HTML, images, and unsafe links", () => {
		const { container } = render(
			<MessageResponse variant="reasoning">
				{
					"![image](https://example.com/image.png)\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n[safe](https://example.com)"
				}
			</MessageResponse>
		);
		expect(container.querySelector("img, script")).toBeNull();
		const links = [...container.querySelectorAll("a")];
		expect(
			links.every((link) => link.getAttribute("href") === "https://example.com")
		).toBe(true);
		expect(links).toHaveLength(1);
	});
});
