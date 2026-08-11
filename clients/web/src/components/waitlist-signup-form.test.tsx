import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildWaitlistStorageKey,
	WAITLIST_RATE_LIMIT_WINDOW_MS,
} from "../lib/waitlist";
import { WaitlistSignupForm } from "./waitlist-signup-form";

const { toastMock } = vi.hoisted(() => ({
	toastMock: Object.assign(vi.fn(), {
		error: vi.fn(),
		success: vi.fn(),
	}),
}));

vi.mock("sonner", () => ({
	toast: toastMock,
}));

function createLocalStorageMock(): Storage {
	const store = new Map<string, string>();

	return {
		clear() {
			store.clear();
		},
		getItem(key) {
			return store.get(key) ?? null;
		},
		key(index) {
			return Array.from(store.keys())[index] ?? null;
		},
		get length() {
			return store.size;
		},
		removeItem(key) {
			store.delete(key);
		},
		setItem(key, value) {
			store.set(key, value);
		},
	} as Storage;
}

describe("WaitlistSignupForm", () => {
	const fetchMock = vi.fn<typeof fetch>();

	beforeEach(() => {
		const localStorageMock = createLocalStorageMock();

		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("localStorage", localStorageMock);
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: localStorageMock,
		});
		vi.spyOn(Date, "now").mockReturnValue(1_762_800_000_000);
		localStorageMock.clear();
		toastMock.mockReset();
		toastMock.error.mockReset();
		toastMock.success.mockReset();
		fetchMock.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("blocks invalid emails before sending a request", async () => {
		render(<WaitlistSignupForm />);
		const form = screen
			.getByRole("button", {
				name: "Join the waitlist",
			})
			.closest("form");

		fireEvent.change(screen.getByLabelText("Email"), {
			target: { value: "invalid-email" },
		});
		if (!form) {
			throw new Error("waitlist form not found");
		}
		fireEvent.submit(form);

		expect(await screen.findByText("Email is invalid")).toBeTruthy();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rate limits the same email for 3 minutes on the client", async () => {
		const normalizedEmail = "rate-limited@example.com";
		const form = render(<WaitlistSignupForm />).container.querySelector("form");
		window.localStorage.setItem(
			buildWaitlistStorageKey(normalizedEmail),
			String(Date.now() - WAITLIST_RATE_LIMIT_WINDOW_MS + 1000)
		);
		if (!form) {
			throw new Error("waitlist form not found");
		}

		fireEvent.change(screen.getByLabelText("Email"), {
			target: { value: "Rate-Limited@Example.com" },
		});
		fireEvent.submit(form);

		await waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith(
				"Please wait 3 minutes before trying this email again."
			);
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("submits a new waitlist email and stores the local cooldown", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ ok: true, status: "created" }), {
				status: 201,
				headers: {
					"content-type": "application/json",
				},
			})
		);

		const form = render(<WaitlistSignupForm />).container.querySelector("form");
		if (!form) {
			throw new Error("waitlist form not found");
		}

		fireEvent.change(screen.getByLabelText("Email"), {
			target: { value: "New@Example.com" },
		});
		fireEvent.submit(form);

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith("/api/waitlist", {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/json",
				},
				body: JSON.stringify({ email: "new@example.com" }),
			});
		});

		await waitFor(() => {
			expect(toastMock.success).toHaveBeenCalledWith("You're on the waitlist.");
		});
		expect(
			window.localStorage.getItem(buildWaitlistStorageKey("new@example.com"))
		).toBe(String(Date.now()));
		expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("");
	});

	it("shows the duplicate toast when the email already exists", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ ok: true, status: "already_exists" }), {
				status: 200,
				headers: {
					"content-type": "application/json",
				},
			})
		);

		const form = render(<WaitlistSignupForm />).container.querySelector("form");
		if (!form) {
			throw new Error("waitlist form not found");
		}

		fireEvent.change(screen.getByLabelText("Email"), {
			target: { value: "existing@example.com" },
		});
		fireEvent.submit(form);

		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith("You're already on the waitlist.");
		});
		expect(
			window.localStorage.getItem(
				buildWaitlistStorageKey("existing@example.com")
			)
		).toBe(String(Date.now()));
	});

	it("shows the request error toast when the waitlist API returns malformed JSON", async () => {
		fetchMock.mockResolvedValue(
			new Response("{bad json", {
				status: 201,
				headers: {
					"content-type": "application/json",
				},
			})
		);

		const form = render(<WaitlistSignupForm />).container.querySelector("form");
		if (!form) {
			throw new Error("waitlist form not found");
		}

		fireEvent.change(screen.getByLabelText("Email"), {
			target: { value: "broken@example.com" },
		});
		fireEvent.submit(form);

		await waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith(
				"Failed to join the waitlist."
			);
		});
		expect(
			window.localStorage.getItem(buildWaitlistStorageKey("broken@example.com"))
		).toBeNull();
	});
});
