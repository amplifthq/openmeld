import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FormEvent } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ClientAuthForm } from "./client-auth-form";

describe("ClientAuthForm", () => {
	it("renders auth form controls disabled before hydration", () => {
		const html = renderToString(
			<ClientAuthForm>
				<input name="email" type="email" />
				<button type="submit">Sign in</button>
			</ClientAuthForm>
		);

		expect(html).toContain("<fieldset");
		expect(html).toContain('disabled=""');
	});

	it("allows submit only after hydration", async () => {
		const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
		});

		render(
			<ClientAuthForm data-testid="auth-form" onSubmit={onSubmit}>
				<input aria-label="Email" name="email" type="email" />
				<button type="submit">Sign in</button>
			</ClientAuthForm>
		);

		await waitFor(() => {
			expect(
				screen.getByTestId("auth-form").querySelector("fieldset")?.disabled
			).toBe(false);
		});

		fireEvent.submit(screen.getByTestId("auth-form"));

		expect(onSubmit).toHaveBeenCalledTimes(1);
	});
});
