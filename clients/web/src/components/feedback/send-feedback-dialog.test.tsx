import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { SendFeedbackDialog } from "./send-feedback-dialog";

const ISSUE_ID = "feedback_issue_f4980202-efe0-467c-bcc3-92760fce0c69";
const toastMock = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: toastMock,
}));

describe("SendFeedbackDialog", () => {
	const fetchMock = vi.fn<typeof fetch>();

	beforeEach(() => {
		fetchMock.mockReset();
		toastMock.error.mockReset();
		toastMock.success.mockReset();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("defaults to experience and submits a changed category through the Web feedback contract", async () => {
		fetchMock.mockResolvedValue(successResponse());
		renderDialog();

		expect(
			screen
				.getByRole("tab", { name: "Experience" })
				.getAttribute("aria-selected")
		).toBe("true");
		fireEvent.click(screen.getByRole("tab", { name: "Idea" }));
		fireEvent.change(screen.getByLabelText("Summary"), {
			target: { value: "A clearer setup progress view" },
		});
		fireEvent.change(screen.getByLabelText("Details (optional)"), {
			target: { value: "Show which step is currently running." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [, init] = fetchMock.mock.calls[0] ?? [];
		expect(JSON.parse(String(init?.body))).toEqual({
			category: "idea",
			summary: "A clearer setup progress view",
			details: "Show which step is currently running.",
			submitterKind: "human",
			clientContext: { clientKind: "web" },
		});
		expect(init?.credentials).toBe("include");
	});

	it("blocks an overlong summary before sending a request", () => {
		renderDialog();

		fireEvent.change(screen.getByLabelText("Summary"), {
			target: { value: "x".repeat(201) },
		});

		expect(screen.getByText("201/200")).toBeTruthy();
		expect(
			(
				screen.getByRole("button", {
					name: "Send feedback",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("clears and closes the form after a successful submission", async () => {
		fetchMock.mockResolvedValue(successResponse());
		const onOpenChange = vi.fn();
		renderDialog({ onOpenChange });
		const summary = screen.getByLabelText("Summary") as HTMLInputElement;
		const details = screen.getByLabelText(
			"Details (optional)"
		) as HTMLTextAreaElement;

		fireEvent.change(summary, { target: { value: "The rail was helpful" } });
		fireEvent.change(details, { target: { value: "Thank you." } });
		fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

		await waitFor(() => {
			expect(toastMock.success).toHaveBeenCalledWith(
				"Feedback sent. Issue #f4980202."
			);
		});
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(summary.value).toBe("");
		expect(details.value).toBe("");
		expect(
			screen
				.getByRole("tab", { name: "Experience" })
				.getAttribute("aria-selected")
		).toBe("true");
	});

	it("clears the form when canceled", () => {
		const onOpenChange = vi.fn();
		renderDialog({ onOpenChange });
		const summary = screen.getByLabelText("Summary") as HTMLInputElement;

		fireEvent.change(summary, { target: { value: "Discard this draft" } });
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(summary.value).toBe("");
	});

	it.each([
		{
			code: "feedback.submit.rate_limited",
			expected:
				"Too much feedback was sent recently. Please wait a minute and try again.",
			status: 429,
		},
		{
			code: "feedback.submit.inbox_not_found",
			expected: "Feedback is temporarily unavailable. Please try again later.",
			status: 404,
		},
		{
			code: "feedback.submit.disabled",
			expected: "Feedback is temporarily unavailable. Please try again later.",
			status: 403,
		},
	])("maps $code to product copy", async ({ code, expected, status }) => {
		fetchMock.mockResolvedValue(errorResponse({ code, status }));
		renderDialog();
		fireEvent.change(screen.getByLabelText("Summary"), {
			target: { value: "Feedback submission test" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

		await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expected));
	});

	it("disables the form while submission is pending", async () => {
		fetchMock.mockImplementation(() => new Promise(() => undefined));
		renderDialog();
		fireEvent.change(screen.getByLabelText("Summary"), {
			target: { value: "Please keep this pending" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

		await waitFor(() => {
			expect(
				(
					screen.getByRole("button", {
						name: "Sending feedback…",
					}) as HTMLButtonElement
				).disabled
			).toBe(true);
		});
		expect(
			(screen.getByLabelText("Summary") as HTMLInputElement).disabled
		).toBe(true);
		expect(
			(screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
	});
});

function renderDialog(input: { onOpenChange?: (open: boolean) => void } = {}) {
	return render(
		<TestQueryClientProvider>
			<SendFeedbackDialog
				onOpenChange={input.onOpenChange ?? vi.fn()}
				open={true}
			/>
		</TestQueryClientProvider>
	);
}

function successResponse(): Response {
	return Response.json({ ok: true, issueId: ISSUE_ID });
}

function errorResponse(input: { code: string; status: number }): Response {
	return Response.json(
		{
			ok: false,
			error: {
				code: input.code,
				message: "private upstream detail",
				requestId: "req-feedback-web-test",
			},
		},
		{ status: input.status }
	);
}
