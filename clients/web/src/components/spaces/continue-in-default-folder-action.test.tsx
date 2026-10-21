import { resolvePublicAgentFailureRecovery } from "@openmeld/schemas";
import { MAX_TEXT_LENGTH } from "@openmeld/schemas/schemas";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFolderContinueText } from "#/lib/spaces/continue-in-default-folder";
import { resolveWakeFailureDisplay } from "#/lib/spaces/wake-failure-display";
import { TestQueryClientProvider } from "#/test-support/query-client";
import {
	ContinueInDefaultFolderAction,
	FolderContinueProvider,
} from "./continue-in-default-folder-action";

const postNormalMessage = vi.hoisted(() => vi.fn());
const readFolders = vi.hoisted(() => vi.fn());
const editContext = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => ({
		postNormalMessage,
		postThreadSignal: vi.fn(),
	}),
}));
vi.mock("#/lib/profiles/agent-profile-folders", () => ({
	readAgentProfileFolders: readFolders,
}));
vi.mock("./space-agent-profile-edit-context", () => ({
	useOptionalSpaceAgentProfileEditContext: () => editContext.value,
}));

const CLIENT_MESSAGE_ID = /^folder-continue:v1:/u;
const SHORTENED_ENDING =
	/The full request is the message this replies to\.\]$/u;
const SHORT_ENDING = /\nshort$/u;
const AGENT = "agt_11111111-1111-4111-8111-111111111111";
const OWNER_PROFILE = "human-owner";
const FOLDER_ONE = "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11";

function ownerEditContext() {
	return {
		context: { organizationId: "org-1", storageScope: "account-1" },
		profilesById: new Map([
			[AGENT, { defaultProjectId: null, openMeldProfileId: AGENT }],
		]),
	};
}

function renderAction() {
	render(
		<TestQueryClientProvider>
			<FolderContinueProvider
				value={{
					profileId: OWNER_PROFILE,
					source: {
						sourceSignalId: "request-1",
						text: "Summarize the README",
						threadId: null,
					},
					spaceId: "space-1",
				}}
			>
				<ContinueInDefaultFolderAction targetProfileId={AGENT} />
			</FolderContinueProvider>
		</TestQueryClientProvider>
	);
}

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	editContext.value = ownerEditContext();
	postNormalMessage.mockResolvedValue({ ok: true });
	readFolders.mockResolvedValue({
		agentProfileId: AGENT,
		observedAtMs: 1,
		projection: {
			defaultFolderId: FOLDER_ONE,
			folders: [
				{
					displayName: "folder-one",
					folderId: FOLDER_ONE,
					isDefault: true,
					kind: "custom",
				},
			],
			revision: 3,
		},
		status: "current",
		target: { deviceId: "device-1", runtimeLane: "prod" },
	});
});

describe("continue in the default folder (smoke R5-01)", () => {
	it("maps a changed session folder to one owner action and none for others", () => {
		expect(
			resolvePublicAgentFailureRecovery({
				errorCode: "execution_context.workspace_changed",
				targetLabel: "Claude Code",
			})
		).toMatchObject({
			primaryActionId: "continue_in_default_folder",
			recoveryTarget: "session_folder",
		});
		const display = (isCurrentUserManageable: boolean) =>
			resolveWakeFailureDisplay({
				failureReasonCode: "execution_context.workspace_changed",
				targetContext: {
					controllerDisplayName: null,
					isCurrentUserManageable,
					ownerDisplayName: "Felix",
				},
				targetLabel: "Claude Code",
			});
		expect(display(true)).toMatchObject({ actionTarget: "session_folder" });
		expect(display(false)).toMatchObject({ actionTarget: null });
	});

	it("continues the same chat in a new session in the current default folder", async () => {
		renderAction();
		const button = await screen.findByRole("button", {
			name: "Continue in folder-one",
		});
		fireEvent.click(button);
		await waitFor(() => expect(postNormalMessage).toHaveBeenCalledTimes(1));
		const sent = postNormalMessage.mock.calls[0]?.[0];
		expect(sent).toMatchObject({
			// A new Session with no folder id runs in the Agent's default folder.
			contextSelection: { mode: "new" },
			messageEnvelope: {
				activationTargets: [AGENT],
				replyToSignalId: "request-1",
			},
			spaceId: "space-1",
		});
		expect(sent.contextSelection).not.toHaveProperty("folderId");
		// The handoff names no folder: the Service starts the Session in the
		// default folder current at that moment.
		expect(sent.text).toContain("in your current working folder");
		expect(sent.text).not.toContain("folder-one");
		expect(sent.text).toContain("Summarize the README");
		expect(sent.meta.clientMessageId).toMatch(CLIENT_MESSAGE_ID);
		expect(
			await screen.findByText(
				"Continuing in a new session. Follow its progress in this chat."
			)
		).toBeTruthy();
	});

	it("names no folder from a recorded projection that may be stale", async () => {
		readFolders.mockResolvedValue({
			...(await readFolders()),
			status: "recorded",
		});
		renderAction();
		expect(
			await screen.findByRole("button", {
				name: "Continue in the default folder",
			})
		).toBeTruthy();
	});

	it("keeps a maximum-length request within the Space text limit", () => {
		const text = buildFolderContinueText({ text: "x".repeat(MAX_TEXT_LENGTH) });
		expect(text).toHaveLength(MAX_TEXT_LENGTH);
		expect(text).toMatch(SHORTENED_ENDING);
		expect(buildFolderContinueText({ text: "short" })).toMatch(SHORT_ENDING);
	});

	it("offers nothing to someone who does not own the Agent", () => {
		editContext.value = {
			context: { organizationId: "org-1", storageScope: "account-1" },
			profilesById: new Map(),
		};
		renderAction();
		expect(screen.queryByRole("button")).toBeNull();
		expect(postNormalMessage).not.toHaveBeenCalled();
	});
});
