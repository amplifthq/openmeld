import type { Project } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectFormDialog } from "./project-form-dialog";

const REPOSITORY_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;

afterEach(cleanup);

describe("ProjectFormDialog", () => {
	it("previews the shared slug but omits it until Advanced is explicitly edited", async () => {
		const onSubmit = vi.fn();
		renderDialog({ onSubmit });

		fireEvent.change(screen.getByLabelText("Project name"), {
			target: { value: "Café Tools" },
		});
		expect(screen.getByText("cafe-tools")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Create Project" }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(onSubmit.mock.calls[0]?.[0]).toEqual({ name: "Café Tools" });
	});

	it("shows and submits the safe normalized repository URL with its fingerprint", async () => {
		const onSubmit = vi.fn();
		renderDialog({ onSubmit });
		fireEvent.change(screen.getByLabelText("Project name"), {
			target: { value: "OpenMeld" },
		});
		fireEvent.change(screen.getByLabelText("Repository URL (optional)"), {
			target: { value: "git@GitHub.com:OpenAI/OpenMeld.git" },
		});
		expect(
			screen.getByText("This will be recognized as github.com/openai/openmeld.")
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Create Project" }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		const submission = onSubmit.mock.calls[0]?.[0];
		expect(submission).toEqual({
			name: "OpenMeld",
			repositoryFingerprint: expect.stringMatching(
				REPOSITORY_FINGERPRINT_PATTERN
			),
			repositoryUrl: "https://github.com/openai/openmeld",
		});
		expect(JSON.stringify(submission)).not.toContain("git@GitHub.com");
	});

	it("shows the saved repository URL when editing", () => {
		renderDialog({
			onSubmit: vi.fn(),
			project: project({
				repositoryFingerprint: `sha256:${"a".repeat(64)}`,
				repositoryUrl: "https://github.com/amplifthq/openmeld",
			}),
		});

		expect(
			(screen.getByLabelText("Repository URL (optional)") as HTMLInputElement)
				.value
		).toBe("https://github.com/amplifthq/openmeld");
		expect(
			screen.getByText("Saved as https://github.com/amplifthq/openmeld.")
		).toBeTruthy();
	});

	it("keeps an unsupported local URL out of the request without blocking creation", async () => {
		const onSubmit = vi.fn();
		renderDialog({ onSubmit });
		fireEvent.change(screen.getByLabelText("Project name"), {
			target: { value: "Local notes" },
		});
		fireEvent.change(screen.getByLabelText("Repository URL (optional)"), {
			target: { value: "file:///Users/felix/local-notes" },
		});
		expect(
			screen.getByText(
				"OpenMeld can’t use a local path or file URL as a repository identity. You can still create this Project without one."
			)
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Create Project" }));

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith({ name: "Local notes" })
		);
	});

	it("explains unsupported remote protocols without blocking creation", async () => {
		const onSubmit = vi.fn();
		renderDialog({ onSubmit });
		fireEvent.change(screen.getByLabelText("Project name"), {
			target: { value: "Legacy mirror" },
		});
		fireEvent.change(screen.getByLabelText("Repository URL (optional)"), {
			target: { value: "ftp://example.com/legacy.git" },
		});

		expect(
			screen.getByText(
				"OpenMeld can’t use that Repository URL. Use a Git, HTTP, HTTPS, or SSH remote. You can still create this Project without one."
			)
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Create Project" }));

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith({ name: "Legacy mirror" })
		);
	});

	it("submits an explicitly edited CLI slug and keeps an existing slug stable on rename", async () => {
		const createSubmit = vi.fn();
		const page = renderDialog({ onSubmit: createSubmit });
		fireEvent.change(screen.getByLabelText("Project name"), {
			target: { value: "OpenMeld Web" },
		});
		fireEvent.click(screen.getByText("Advanced"));
		fireEvent.change(screen.getByLabelText("CLI slug"), {
			target: { value: "openmeld-app" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
		await waitFor(() =>
			expect(createSubmit).toHaveBeenCalledWith({
				name: "OpenMeld Web",
				slug: "openmeld-app",
			})
		);

		page.unmount();
		const editSubmit = vi.fn();
		renderDialog({ onSubmit: editSubmit, project: project() });
		fireEvent.change(screen.getByLabelText("Project name"), {
			target: { value: "OpenMeld Product" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(editSubmit).toHaveBeenCalledWith({ name: "OpenMeld Product" })
		);
	});
});

function renderDialog(input: {
	onSubmit: ReturnType<typeof vi.fn>;
	project?: Project | null;
}) {
	return render(
		<ProjectFormDialog
			errorMessage={null}
			onOpenChange={vi.fn()}
			onSubmit={input.onSubmit}
			open={true}
			project={input.project ?? null}
			submitting={false}
		/>
	);
}

function project(overrides: Partial<Project> = {}): Project {
	return {
		archivedAtMs: null,
		canArchive: true,
		canManage: true,
		createdAtMs: 1,
		createdByUserId: "user-1",
		id: "project-1",
		name: "OpenMeld",
		organizationId: "org-1",
		repositoryFingerprint: null,
		repositoryUrl: null,
		slug: "openmeld",
		updatedAtMs: 1,
		...overrides,
	};
}
