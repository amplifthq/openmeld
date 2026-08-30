import { beforeEach, describe, expect, it, vi } from "vitest";
import { copySpaceMessage } from "./space-message-copy";

const writeText = vi.fn();
const write = vi.fn();

class ClipboardItemMock {
	static supports(type: string) {
		return type === "image/png";
	}

	readonly data: Record<string, Blob | Promise<Blob>>;

	constructor(data: Record<string, Blob | Promise<Blob>>) {
		this.data = data;
	}
}

describe("copySpaceMessage", () => {
	beforeEach(() => {
		write.mockReset();
		writeText.mockReset();
		vi.stubGlobal("ClipboardItem", ClipboardItemMock);
		vi.stubGlobal("navigator", {
			clipboard: { write, writeText },
		});
	});

	it("copies canonical message text without reply or outcome metadata", async () => {
		writeText.mockResolvedValue(undefined);

		const result = await copySpaceMessage({
			attachments: [],
			files: [],
			loadFile: vi.fn(),
			text: "Canonical message",
		});

		expect(result).toBe("text");
		expect(writeText).toHaveBeenCalledWith("Canonical message");
		expect(write).not.toHaveBeenCalled();
	});

	it("starts an image clipboard write before loading the attachment", async () => {
		let resolveImage!: (value: Blob) => void;
		const loadAttachment = vi.fn(
			() =>
				new Promise<Blob>((resolve) => {
					resolveImage = resolve;
				})
		);
		write.mockImplementation(async (items: readonly ClipboardItemMock[]) => {
			const image = await items[0]?.data["image/png"];
			expect(image).toBeInstanceOf(Blob);
		});

		const pendingCopy = copySpaceMessage({
			attachments: [{ id: "image-1", mimeType: "image/png" }],
			files: [],
			loadAttachment,
			loadFile: vi.fn(),
			text: "",
		});

		expect(write).toHaveBeenCalledTimes(1);
		expect(loadAttachment).toHaveBeenCalledWith("image-1");
		resolveImage(new Blob(["image"], { type: "image/png" }));
		expect(await pendingCopy).toBe("image");
	});

	it("does not fake copying an unsupported file type", async () => {
		const result = await copySpaceMessage({
			attachments: [],
			files: [
				{
					fileId: "file-pdf",
					mimeType: "application/pdf",
					revision: 3,
				},
			],
			loadFile: vi.fn(),
			text: "",
		});

		expect(result).toBe("unsupported");
		expect(write).not.toHaveBeenCalled();
	});
});
