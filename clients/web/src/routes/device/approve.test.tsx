import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";

const fetchMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
			<a href={to} {...props}>
				{children}
			</a>
		),
	};
});

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: toastSuccessMock,
	},
}));

import { Route } from "./approve";

function renderDeviceApproval(searchParams = "user_code=ABCD1234") {
	const Component = Route.options.component as ComponentType;
	return render(
		<TestQueryClientProvider>
			<NuqsTestingAdapter hasMemory searchParams={searchParams}>
				<Component />
			</NuqsTestingAdapter>
		</TestQueryClientProvider>
	);
}

describe("device approval", () => {
	beforeEach(() => {
		fetchMock.mockReset();
		toastErrorMock.mockReset();
		toastSuccessMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("claims the device code before enabling approval", async () => {
		fetchMock.mockImplementation(
			(input: RequestInfo | URL, init?: RequestInit) => {
				if (
					input === "/api/auth/device?user_code=ABCD1234" &&
					init?.method === "GET"
				) {
					return new Response(
						JSON.stringify({
							status: "pending",
							user_code: "ABCD1234",
						}),
						{
							headers: { "content-type": "application/json" },
							status: 200,
						}
					);
				}

				if (input === "/api/auth/device/approve" && init?.method === "POST") {
					return new Response(JSON.stringify({ success: true }), {
						headers: { "content-type": "application/json" },
						status: 200,
					});
				}

				throw new Error(`Unexpected request: ${String(input)}`);
			}
		);

		renderDeviceApproval();

		const approveButton = screen.getByRole("button", { name: "Approve" });
		expect((approveButton as HTMLButtonElement).disabled).toBe(true);

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/auth/device?user_code=ABCD1234",
				expect.objectContaining({
					credentials: "include",
					method: "GET",
				})
			);
		});
		await waitFor(() => {
			expect((approveButton as HTMLButtonElement).disabled).toBe(false);
		});

		fireEvent.click(approveButton);

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/auth/device/approve",
				expect.objectContaining({
					body: JSON.stringify({ userCode: "ABCD1234" }),
					credentials: "include",
					method: "POST",
				})
			);
		});
		expect(
			await screen.findByText("Device approved. You can return to CLI.")
		).toBeTruthy();
	});

	it("keeps decisions disabled when the device code cannot be claimed", async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					error: "invalid_request",
					error_description: "Invalid user code",
				}),
				{
					headers: { "content-type": "application/json" },
					status: 400,
				}
			)
		);

		renderDeviceApproval();

		expect(
			await screen.findByText(
				"This device code is invalid or has expired. Start sign-in again from the CLI."
			)
		).toBeTruthy();
		expect(
			(screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
		expect(
			(screen.getByRole("button", { name: "Deny" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
