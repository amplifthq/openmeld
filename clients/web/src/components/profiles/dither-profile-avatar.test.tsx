import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { buildDitherProfileAvatarSeed } from "#/components/profiles/dither-profile-avatar-seed";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("DitherProfileAvatar", () => {
	it("keeps Human generated identities stable", () => {
		expect(
			buildDitherProfileAvatarSeed({
				profileId: "profile-1",
				profileKind: "human",
			})
		).toBe("openmeld-dither-profile-avatar:v1:human:profile-1");
	});

	it("keeps a Human Profile image authoritative over its generated fallback", () => {
		mockCanvasContext();
		const { container } = render(
			<DitherProfileAvatar
				avatarImageUrl="https://example.com/felix.png"
				profileId="human-1"
				profileKind="human"
				profileName="Felix Lee"
				size={24}
			/>
		);

		expect(container.querySelector("img")?.getAttribute("src")).toBe(
			"https://example.com/felix.png"
		);
		expect(screen.getByText("FL")).toBeTruthy();
		expect(
			container
				.querySelector("canvas")
				?.getAttribute("data-profile-avatar-seed")
		).toBe("openmeld-dither-profile-avatar:v1:human:human-1");
	});

	it("does not cover profile pixels with the generic Avatar border", () => {
		mockCanvasContext();
		render(
			<DitherProfileAvatar
				data-testid="borderless-profile-avatar"
				profileId="human-1"
				profileKind="human"
				profileName="Felix Lee"
				size={32}
			/>
		);

		expect(screen.getByTestId("borderless-profile-avatar").className).toContain(
			"after:border-0"
		);
	});
});

function mockCanvasContext(): void {
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
		fillRect: vi.fn(),
		fillStyle: "",
		globalCompositeOperation: "source-over",
	} as unknown as CanvasRenderingContext2D);
}
