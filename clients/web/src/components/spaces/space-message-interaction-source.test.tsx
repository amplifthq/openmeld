import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SpaceMessageInteractionSource } from "./space-message-interaction-source";

describe("SpaceMessageInteractionSource", () => {
	it("shows a familiar product name without exposing session metadata", () => {
		render(
			<SpaceMessageInteractionSource
				source={{
					client: "codex",
					kind: "local_agent",
					sessionId: "private-local-thread-id",
				}}
			/>
		);

		expect(screen.getByText("via Codex")).toBeTruthy();
		expect(screen.queryByText("private-local-thread-id")).toBeNull();
	});

	it("renders nothing for an ordinary OpenMeld message", () => {
		const { container } = render(<SpaceMessageInteractionSource />);

		expect(container.innerHTML).toBe("");
	});
});
