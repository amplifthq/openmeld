import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadUrlContent } from "./space-file-utils";

describe("downloadUrlContent", () => {
	afterEach(() => {
		Reflect.deleteProperty(URL, "createObjectURL");
		Reflect.deleteProperty(URL, "revokeObjectURL");
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("downloads authenticated bytes with the original file name", async () => {
		const blob = new Blob(["OpenMeld download smoke"], {
			type: "text/plain",
		});
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(blob, {
				headers: { "content-type": "text/plain" },
				status: 200,
			})
		);
		let clickedAnchor: HTMLAnchorElement | undefined;
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(function captureAnchor(this: HTMLAnchorElement) {
				clickedAnchor = this;
			});
		vi.stubGlobal("fetch", fetchMock);
		const createObjectURL = vi.fn().mockReturnValue("blob:download-smoke");
		const revokeObjectURL = vi.fn();
		Object.defineProperties(URL, {
			createObjectURL: { configurable: true, value: createObjectURL },
			revokeObjectURL: { configurable: true, value: revokeObjectURL },
		});

		await downloadUrlContent("navigation-smoke.txt", "/v1/files/private");

		expect(fetchMock).toHaveBeenCalledWith("/v1/files/private", {
			credentials: "include",
		});
		if (!clickedAnchor) {
			throw new Error("The download link was not clicked.");
		}
		expect(clickedAnchor.download).toBe("navigation-smoke.txt");
		expect(clickedAnchor.href).toBe("blob:download-smoke");
		expect(click).toHaveBeenCalledTimes(1);
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:download-smoke");
	});
});
