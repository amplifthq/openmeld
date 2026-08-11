import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserAvatarCard } from "./user-avatar-card";

const LOG_OUT_LINK_NAME_PATTERN = /log out/i;

const useAccountAvatarMock = vi.hoisted(() => vi.fn());
const useAccountSessionMock = vi.hoisted(() => vi.fn());
const useDefaultHumanProfileMock = vi.hoisted(() => vi.fn());
const useRemoveAccountAvatarMock = vi.hoisted(() => vi.fn());
const useUpdateAccountAvatarMock = vi.hoisted(() => vi.fn());
const createIdentityImageCropDraftMock = vi.hoisted(() => vi.fn());
const cropIdentityImageMock = vi.hoisted(() => vi.fn());
const releaseIdentityImageCropDraftMock = vi.hoisted(() => vi.fn());
const removeAccountAvatarMock = vi.hoisted(() => vi.fn());
const updateAccountAvatarMock = vi.hoisted(() => vi.fn());

vi.mock("#/hooks/account.hooks", () => ({
	useAccountAvatar: useAccountAvatarMock,
	useAccountSession: useAccountSessionMock,
	useRemoveAccountAvatar: useRemoveAccountAvatarMock,
	useUpdateAccountAvatar: useUpdateAccountAvatarMock,
}));

vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: useDefaultHumanProfileMock,
}));

vi.mock("#/lib/images/identity-image-crop", () => ({
	createIdentityImageCropDraft: createIdentityImageCropDraftMock,
	cropIdentityImage: cropIdentityImageMock,
	DEFAULT_IDENTITY_IMAGE_CROP: {
		positionX: 0,
		positionY: 0,
		zoom: 1,
	},
	releaseIdentityImageCropDraft: releaseIdentityImageCropDraftMock,
	resolveIdentityImageCropPlacement: () => ({
		height: 240,
		left: 0,
		top: 0,
		width: 240,
	}),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

describe("UserAvatarCard", () => {
	beforeEach(() => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			fillRect: vi.fn(),
			fillStyle: "",
			globalCompositeOperation: "source-over",
		} as unknown as CanvasRenderingContext2D);
		useDefaultHumanProfileMock.mockReturnValue({
			defaultHumanProfile: {
				avatarUrl: null,
				profileName: "Default Human Profile",
				openMeldProfileId: "default-human-profile-1",
			},
		});
		useAccountAvatarMock.mockReturnValue({
			data: {
				avatar: null,
				defaultHumanProfileId: "default-human-profile-1",
				ok: true,
			},
			isPending: false,
		});
		createIdentityImageCropDraftMock.mockResolvedValue({
			height: 800,
			previewUrl: "blob:profile-photo",
			width: 1200,
		});
		cropIdentityImageMock.mockResolvedValue({
			bytes: new Blob([new Uint8Array([1])], { type: "image/webp" }),
			mimeType: "image/webp",
		});
		releaseIdentityImageCropDraftMock.mockReset();
		updateAccountAvatarMock.mockReset().mockResolvedValue({
			avatar:
				"https://gateway.example/v1/profile-avatars/default-human-profile-1/avatar.webp",
			defaultHumanProfileId: "default-human-profile-1",
			ok: true,
		});
		removeAccountAvatarMock.mockReset().mockResolvedValue({
			avatar: null,
			defaultHumanProfileId: "default-human-profile-1",
			ok: true,
		});
		useUpdateAccountAvatarMock.mockReturnValue({
			error: null,
			isError: false,
			isPending: false,
			mutateAsync: updateAccountAvatarMock,
			reset: vi.fn(),
		});
		useRemoveAccountAvatarMock.mockReturnValue({
			error: null,
			isError: false,
			isPending: false,
			mutateAsync: removeAccountAvatarMock,
		});
	});

	afterEach(() => {
		cleanup();
		useAccountAvatarMock.mockReset();
		useAccountSessionMock.mockReset();
		useDefaultHumanProfileMock.mockReset();
		useRemoveAccountAvatarMock.mockReset();
		useUpdateAccountAvatarMock.mockReset();
		createIdentityImageCropDraftMock.mockReset();
		cropIdentityImageMock.mockReset();
		releaseIdentityImageCropDraftMock.mockReset();
		vi.restoreAllMocks();
	});

	it("renders a loading skeleton while the account session is pending", () => {
		useAccountSessionMock.mockReturnValue({
			data: undefined,
			isPending: true,
		});

		render(<UserAvatarCard />);

		expect(screen.getByText("User Profile")).toBeTruthy();
		expect(
			screen.getByText("Your account information and status.")
		).toBeTruthy();
	});

	it("renders account identity with avatar image and fallback initials", () => {
		useAccountAvatarMock.mockReturnValue({
			data: {
				avatar: "https://example.com/ada.png",
				defaultHumanProfileId: "default-human-profile-1",
				ok: true,
			},
			isPending: false,
		});
		useAccountSessionMock.mockReturnValue({
			data: {
				user: {
					createdAt: "2024-01-02T00:00:00.000Z",
					email: "ada@example.com",
					emailVerified: true,
					image: "https://example.com/ada.png",
					name: "Ada Lovelace",
				},
			},
			isPending: false,
		});

		render(<UserAvatarCard />);

		const avatarImage = document.querySelector("img");
		expect(avatarImage?.getAttribute("src")).toBe(
			"https://example.com/ada.png"
		);
		expect(screen.getByText("AL")).toBeTruthy();
		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("ada@example.com")).toBeTruthy();
		expect(screen.getByText("Verified")).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: LOG_OUT_LINK_NAME_PATTERN })
				.getAttribute("href")
		).toBe("/logout");
	});

	it("keeps the account card without inventing a Dither identity when the default Human Profile is unavailable", () => {
		useDefaultHumanProfileMock.mockReturnValue({
			defaultHumanProfile: null,
		});
		useAccountSessionMock.mockReturnValue({
			data: {
				user: {
					createdAt: "2024-01-02T00:00:00.000Z",
					email: "ada@example.com",
					emailVerified: true,
					id: "user-1",
					image: null,
					name: "Ada Lovelace",
				},
			},
			isPending: false,
		});

		const { container } = render(<UserAvatarCard />);

		expect(container.querySelector("canvas")).toBeNull();
		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("ada@example.com")).toBeTruthy();
		expect(screen.getByText("Verified")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: LOG_OUT_LINK_NAME_PATTERN })
		).toBeTruthy();
	});

	it("uses the default Human Profile Dither identity", () => {
		useAccountSessionMock.mockReturnValue({
			data: {
				user: {
					createdAt: "2024-01-02T00:00:00.000Z",
					email: "ada@example.com",
					emailVerified: true,
					id: "user-1",
					image: null,
					name: "Ada Lovelace",
				},
			},
			isPending: false,
		});

		render(<UserAvatarCard />);

		const avatar = screen.getByTestId("account-human-profile-avatar");
		const ditherCanvas = avatar.querySelector(
			'[data-slot="dither-avatar-background"]'
		);
		expect(ditherCanvas).toBeTruthy();
		expect(ditherCanvas?.getAttribute("data-profile-avatar-seed")).toBe(
			"openmeld-dither-profile-avatar:v1:human:default-human-profile-1"
		);
		expect(within(avatar).getByText("AL")).toBeTruthy();
		expect(avatar.style.height).toBe("64px");
		expect(avatar.style.width).toBe("64px");
		const avatarEditor = screen.getByTestId("account-avatar-editor");
		const addPhotoButton = within(avatarEditor).getByRole("button", {
			name: "Add photo",
		});
		expect(addPhotoButton.classList.contains("opacity-0")).toBe(true);
		expect(
			addPhotoButton.classList.contains("[@media(hover:none)]:bg-transparent")
		).toBe(true);
		expect(
			addPhotoButton
				.querySelector("svg")
				?.classList.contains("[@media(hover:none)]:bg-black/75")
		).toBe(true);
		expect(
			within(addPhotoButton)
				.getByText("Add photo")
				.classList.contains("[@media(hover:none)]:sr-only")
		).toBe(true);
		expect(avatar.classList.contains("block")).toBe(true);
		expect(screen.queryByText("JPG, PNG, or WebP. Up to 5 MB.")).toBeNull();
	});

	it("remounts the generated avatar when a profile photo is removed", () => {
		useAccountAvatarMock.mockReturnValue({
			data: {
				avatar: "https://example.com/ada.png",
				defaultHumanProfileId: "default-human-profile-1",
				ok: true,
			},
			isPending: false,
		});
		useAccountSessionMock.mockReturnValue({
			data: {
				user: {
					createdAt: "2024-01-02T00:00:00.000Z",
					email: "ada@example.com",
					emailVerified: true,
					image: "https://example.com/ada.png",
					name: "Ada Lovelace",
				},
			},
			isPending: false,
		});
		const { container, rerender } = render(<UserAvatarCard />);
		expect(container.querySelector("img")).toBeTruthy();

		useAccountAvatarMock.mockReturnValue({
			data: {
				avatar: null,
				defaultHumanProfileId: "default-human-profile-1",
				ok: true,
			},
			isPending: false,
		});
		rerender(<UserAvatarCard />);

		expect(container.querySelector("img")).toBeNull();
		expect(
			container
				.querySelector("canvas")
				?.getAttribute("data-profile-avatar-seed")
		).toBe("openmeld-dither-profile-avatar:v1:human:default-human-profile-1");
		expect(screen.getByText("AL")).toBeTruthy();
	});

	it("uses only the Auth-owned image field as the account avatar source", () => {
		useAccountSessionMock.mockReturnValue({
			data: {
				user: {
					createdAt: "2024-01-02T00:00:00.000Z",
					email: "grace@example.com",
					emailVerified: true,
					image: null,
					name: "Grace Hopper",
					picture: "https://example.com/grace-oauth.png",
				},
			},
			isPending: false,
		});

		render(<UserAvatarCard />);

		expect(document.querySelector("img")).toBeNull();
		expect(screen.getByRole("button", { name: "Add photo" })).toBeTruthy();
	});

	it("does not let a stale Human Profile projection override the current Account avatar", () => {
		useDefaultHumanProfileMock.mockReturnValue({
			defaultHumanProfile: {
				avatarUrl: "https://example.com/stale-profile-avatar.png",
				profileName: "Default Human Profile",
				openMeldProfileId: "default-human-profile-1",
			},
		});
		useAccountSessionMock.mockReturnValue({
			data: {
				user: {
					createdAt: "2024-01-02T00:00:00.000Z",
					email: "ada@example.com",
					emailVerified: true,
					id: "user-1",
					image: "https://example.com/current-account-avatar.png",
					name: "Ada Lovelace",
				},
			},
			isPending: false,
		});
		useAccountAvatarMock.mockReturnValue({
			data: {
				avatar: "https://example.com/current-account-avatar.png",
				defaultHumanProfileId: "default-human-profile-1",
				ok: true,
			},
			isPending: false,
		});

		render(<UserAvatarCard />);

		expect(document.querySelector("img")?.getAttribute("src")).toBe(
			"https://example.com/current-account-avatar.png"
		);
	});

	it("does not let a stale Session avatar override a removed Account avatar", () => {
		useAccountSessionMock.mockReturnValue({
			data: {
				user: {
					createdAt: "2024-01-02T00:00:00.000Z",
					email: "ada@example.com",
					emailVerified: true,
					id: "user-1",
					image: "https://lh3.googleusercontent.com/stale-google",
					name: "Ada Lovelace",
				},
			},
			isPending: false,
		});

		render(<UserAvatarCard />);

		expect(document.querySelector("img")).toBeNull();
		expect(screen.getByRole("button", { name: "Add photo" })).toBeTruthy();
	});

	it("keeps file selection errors next to the avatar", () => {
		useAccountSessionMock.mockReturnValue({
			data: {
				user: {
					createdAt: "2024-01-02T00:00:00.000Z",
					email: "ada@example.com",
					emailVerified: true,
					image: null,
					name: "Ada Lovelace",
				},
			},
			isPending: false,
		});

		render(<UserAvatarCard />);

		fireEvent.change(screen.getByLabelText("Choose profile photo"), {
			target: {
				files: [
					new File([new Uint8Array([1])], "profile.txt", {
						type: "text/plain",
					}),
				],
			},
		});

		expect(
			within(screen.getByTestId("account-avatar-editor")).getByRole("alert")
				.textContent
		).toBe("Choose a JPG, PNG, or WebP image.");
	});

	it("lets the owner crop and replace the default Human Profile photo", async () => {
		useAccountAvatarMock.mockReturnValue({
			data: {
				avatar: "https://example.com/ada.png",
				defaultHumanProfileId: "default-human-profile-1",
				ok: true,
			},
			isPending: false,
		});
		useAccountSessionMock.mockReturnValue({
			data: {
				user: {
					createdAt: "2024-01-02T00:00:00.000Z",
					email: "ada@example.com",
					emailVerified: true,
					image: "https://example.com/ada.png",
					name: "Ada Lovelace",
				},
			},
			isPending: false,
		});

		render(<UserAvatarCard />);

		const avatarEditor = screen.getByTestId("account-avatar-editor");
		expect(
			within(avatarEditor).getByRole("button", { name: "Change photo" })
		).toBeTruthy();

		fireEvent.change(screen.getByLabelText("Choose profile photo"), {
			target: {
				files: [
					new File([new Uint8Array([1, 2, 3])], "profile.png", {
						type: "image/png",
					}),
				],
			},
		});

		expect(
			await screen.findByRole("heading", { name: "Adjust profile photo" })
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

		await waitFor(() => {
			expect(cropIdentityImageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					outputSize: 512,
					subject: "Profile photo",
				})
			);
			expect(updateAccountAvatarMock).toHaveBeenCalledWith(
				expect.objectContaining({ mimeType: "image/webp" })
			);
		});
	});

	it("locks the crop dialog while preparing the photo and exposes preparation failures for retry", async () => {
		let rejectCrop!: (reason?: unknown) => void;
		cropIdentityImageMock.mockImplementationOnce(
			() =>
				new Promise((_resolve, reject) => {
					rejectCrop = reject;
				})
		);
		useAccountAvatarMock.mockReturnValue({
			data: {
				avatar: "https://example.com/ada.png",
				defaultHumanProfileId: "default-human-profile-1",
				ok: true,
			},
			isPending: false,
		});
		useAccountSessionMock.mockReturnValue({
			data: {
				user: {
					createdAt: "2024-01-02T00:00:00.000Z",
					email: "ada@example.com",
					emailVerified: true,
					image: "https://example.com/ada.png",
					name: "Ada Lovelace",
				},
			},
			isPending: false,
		});

		render(<UserAvatarCard />);

		fireEvent.change(screen.getByLabelText("Choose profile photo"), {
			target: {
				files: [
					new File([new Uint8Array([1, 2, 3])], "profile.png", {
						type: "image/png",
					}),
				],
			},
		});
		await screen.findByRole("heading", { name: "Adjust profile photo" });

		fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

		const savingButton = screen.getByRole("button", { name: "Saving" });
		expect(savingButton.hasAttribute("disabled")).toBe(true);
		expect(
			screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")
		).toBe(true);
		fireEvent.click(savingButton);
		expect(cropIdentityImageMock).toHaveBeenCalledTimes(1);
		expect(updateAccountAvatarMock).not.toHaveBeenCalled();

		rejectCrop(new Error("OpenMeld could not prepare this profile photo."));

		expect(
			await screen.findByText("OpenMeld could not prepare this profile photo.")
		).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "Save photo" })
				.hasAttribute("disabled")
		).toBe(false);

		fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

		await waitFor(() => {
			expect(updateAccountAvatarMock).toHaveBeenCalledTimes(1);
		});
	});

	it("removes the current profile photo", async () => {
		useAccountAvatarMock.mockReturnValue({
			data: {
				avatar: "https://example.com/ada.png",
				defaultHumanProfileId: "default-human-profile-1",
				ok: true,
			},
			isPending: false,
		});
		useAccountSessionMock.mockReturnValue({
			data: {
				user: {
					createdAt: "2024-01-02T00:00:00.000Z",
					email: "ada@example.com",
					emailVerified: true,
					image: "https://example.com/ada.png",
					name: "Ada Lovelace",
				},
			},
			isPending: false,
		});

		render(<UserAvatarCard />);
		const avatarEditor = screen.getByTestId("account-avatar-editor");
		fireEvent.click(
			within(avatarEditor).getByRole("button", { name: "Remove photo" })
		);
		const confirmation = await screen.findByRole("alertdialog");
		expect(removeAccountAvatarMock).not.toHaveBeenCalled();
		fireEvent.click(
			within(confirmation).getByRole("button", { name: "Remove photo" })
		);

		await waitFor(() => {
			expect(removeAccountAvatarMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(screen.queryByRole("alertdialog")).toBeNull();
		});
	});

	it("falls back to an email initial when the account has no display name", () => {
		useAccountSessionMock.mockReturnValue({
			data: {
				user: {
					createdAt: null,
					email: "felix@example.com",
					emailVerified: false,
					image: null,
					name: null,
				},
			},
			isPending: false,
		});

		render(<UserAvatarCard />);

		expect(screen.getByText("F")).toBeTruthy();
		expect(screen.getByText("No display name")).toBeTruthy();
		expect(screen.getByText("Unverified")).toBeTruthy();
		expect(screen.getByText("Joined Join date unknown")).toBeTruthy();
	});
});
