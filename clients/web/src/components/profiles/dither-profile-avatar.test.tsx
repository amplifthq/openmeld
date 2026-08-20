import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { buildDitherProfileAvatarSeed } from "#/components/profiles/dither-profile-avatar-seed";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("DitherProfileAvatar", () => {
	it("separates Human and Center Agent generated identities", () => {
		expect(
			buildDitherProfileAvatarSeed({
				profileId: "profile-1",
				profileKind: "human",
			})
		).toBe("openmeld-dither-profile-avatar:v1:human:profile-1");
		expect(
			buildDitherProfileAvatarSeed({
				profileId: "profile-1",
				profileKind: "center-agent",
			})
		).toBe("openmeld-dither-profile-avatar:v1:center-agent:profile-1");
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

	it("always renders Center Agent with a Dither background and agent glyph", () => {
		mockCanvasContext();
		const { container } = render(
			<DitherProfileAvatar
				data-testid="center-agent-profile-avatar"
				profileId="center-agent-1"
				profileKind="center-agent"
				profileName="Center Agent"
				size={40}
			/>
		);

		expect(screen.getByTestId("center-agent-profile-avatar")).toBeTruthy();
		expect(
			container.querySelector('[data-slot="center-agent-profile-avatar-glyph"]')
		).toBeTruthy();
		expect(container.querySelector("img")).toBeNull();
	});
});

function mockCanvasContext(): void {
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
		fillRect: vi.fn(),
		fillStyle: "",
		globalCompositeOperation: "source-over",
	} as unknown as CanvasRenderingContext2D);
}
