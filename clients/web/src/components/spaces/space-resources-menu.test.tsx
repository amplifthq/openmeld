import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { SpaceResourcesMenu } from "./space-resources-menu";
import type { SpaceView } from "./space-view";

function Fixture() {
	const [view, setView] = useState<SpaceView>("messages");
	return (
		<>
			<SpaceResourcesMenu activeView={view} onViewChange={setView} />
			<p>{view} view</p>
		</>
	);
}

it("opens resources by keyboard and restores focus when going back to messages", async () => {
	render(<Fixture />);
	const trigger = screen.getByRole("button", { name: "Space resources" });
	expect(screen.queryByRole("menuitem", { name: "Tasks" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Back to messages" })).toBeNull();
	trigger.focus();
	fireEvent.keyDown(trigger, { key: "ArrowDown" });
	const tasks = await screen.findByRole("menuitem", { name: "Tasks" });
	await waitFor(() => expect(document.activeElement).toBe(tasks));
	expect(screen.getByRole("menuitem", { name: "Files" })).toBeTruthy();
	expect(screen.getByRole("menuitem", { name: "Guide" })).toBeTruthy();
	expect(screen.queryByRole("menuitem", { name: "Graph" })).toBeNull();
	fireEvent.click(tasks);
	expect(screen.getByText("tasks view")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Back to messages" }));
	expect(screen.getByText("messages view")).toBeTruthy();
	expect(document.activeElement).toBe(trigger);
});
