import {
	createCenterAgentTasksApi,
	type ListCenterAgentTasksInput,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	CenterAgentTaskDetail,
	ContinueCenterAgentTaskBody,
	ListCenterAgentTasksResponse,
	RetryCenterAgentTaskBody,
	StopCenterAgentTaskBody,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type CenterAgentTasksFailure = StructuredApiClientFailure;

function createWebCenterAgentTasksApi(organizationId: string) {
	return createCenterAgentTasksApi(
		createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
	);
}

export async function listCurrentCenterAgentTasks(
	input: ListCenterAgentTasksInput & { organizationId: string }
): Promise<ListCenterAgentTasksResponse> {
	try {
		const { organizationId, ...request } = input;
		const response =
			await createWebCenterAgentTasksApi(organizationId).list(request);
		assertTaskListIdentity(response, organizationId);
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function getCurrentCenterAgentTask(input: {
	organizationId: string;
	signal?: AbortSignal;
	taskId: string;
}): Promise<CenterAgentTaskDetail> {
	try {
		const response = await createWebCenterAgentTasksApi(
			input.organizationId
		).get({
			signal: input.signal,
			taskId: input.taskId,
		});
		assertTaskDetailIdentity(response, {
			organizationId: input.organizationId,
			taskId: input.taskId,
		});
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function continueCurrentCenterAgentTask(
	input: ContinueCenterAgentTaskBody & {
		organizationId: string;
		taskId: string;
	}
): Promise<CenterAgentTaskDetail> {
	return await mutateCurrentCenterAgentTask({
		action: "continue",
		input,
	});
}

export async function stopCurrentCenterAgentTask(
	input: StopCenterAgentTaskBody & {
		organizationId: string;
		taskId: string;
	}
): Promise<CenterAgentTaskDetail> {
	return await mutateCurrentCenterAgentTask({ action: "stop", input });
}

export async function retryCurrentCenterAgentTask(
	input: RetryCenterAgentTaskBody & {
		organizationId: string;
		taskId: string;
	}
): Promise<CenterAgentTaskDetail> {
	return await mutateCurrentCenterAgentTask({ action: "retry", input });
}

export function resolveCenterAgentTaskErrorMessage(
	error: unknown,
	action: "continue" | "get" | "list" | "retry" | "stop"
): string {
	const failure = toStructuredApiClientFailure(error);
	if (failure.status === 401) {
		return "Sign in again before working with Center Agent Tasks.";
	}
	if (failure.status === 404) {
		return "This Task is no longer available.";
	}
	if (failure.status === 409) {
		return "This Task changed before your request finished. Refresh it and try again.";
	}
	if (
		failure.code === "network.timeout" ||
		failure.code === "network.request_failed"
	) {
		return "OpenMeld could not reach Center Agent Tasks. Try again.";
	}
	const fallback = {
		continue: "OpenMeld could not send your message to this Task.",
		get: "OpenMeld could not load this Task.",
		list: "OpenMeld could not load Center Agent Tasks.",
		retry: "OpenMeld could not retry this Task.",
		stop: "OpenMeld could not stop this Task.",
	} as const;
	return fallback[action];
}

async function mutateCurrentCenterAgentTask(
	input:
		| {
				action: "continue";
				input: ContinueCenterAgentTaskBody & {
					organizationId: string;
					taskId: string;
				};
		  }
		| {
				action: "retry";
				input: RetryCenterAgentTaskBody & {
					organizationId: string;
					taskId: string;
				};
		  }
		| {
				action: "stop";
				input: StopCenterAgentTaskBody & {
					organizationId: string;
					taskId: string;
				};
		  }
): Promise<CenterAgentTaskDetail> {
	const organizationId = input.input.organizationId;
	try {
		const api = createWebCenterAgentTasksApi(organizationId);
		let response: CenterAgentTaskDetail;
		switch (input.action) {
			case "continue": {
				const { organizationId: _, ...request } = input.input;
				response = await api.continue(request);
				break;
			}
			case "retry": {
				const { organizationId: _, ...request } = input.input;
				response = await api.retry(request);
				break;
			}
			case "stop": {
				const { organizationId: _, ...request } = input.input;
				response = await api.stop(request);
				break;
			}
			default:
				return assertNeverTaskMutation(input);
		}
		assertTaskDetailIdentity(response, {
			organizationId,
			taskId: input.input.taskId,
		});
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

function assertNeverTaskMutation(value: never): never {
	throw new Error(
		`Unsupported Center Agent Task action: ${JSON.stringify(value)}`
	);
}

function assertTaskListIdentity(
	response: ListCenterAgentTasksResponse,
	expectedOrganizationId: string
): void {
	if (response.organizationId !== expectedOrganizationId) {
		throwIdentityMismatch(
			`Task list identity mismatch: expected organization ${expectedOrganizationId}, received ${response.organizationId}.`
		);
	}
	for (const task of response.tasks) {
		if (task.organizationId !== expectedOrganizationId) {
			throwIdentityMismatch(
				`Task identity mismatch: expected organization ${expectedOrganizationId}, received ${task.organizationId}.`
			);
		}
	}
}

function assertTaskDetailIdentity(
	detail: CenterAgentTaskDetail,
	expected: { organizationId: string; taskId: string }
): void {
	if (
		detail.task.organizationId !== expected.organizationId ||
		detail.task.id !== expected.taskId
	) {
		throwIdentityMismatch(
			`Task detail identity mismatch: expected ${expected.organizationId}/${expected.taskId}, received ${detail.task.organizationId}/${detail.task.id}.`
		);
	}
	if (
		detail.attempts.some((attempt) => attempt.taskId !== expected.taskId) ||
		detail.events.some((event) => event.taskId !== expected.taskId)
	) {
		throwIdentityMismatch(
			`Task detail contains activity for a different Task than ${expected.taskId}.`
		);
	}
}

function throwIdentityMismatch(message: string): never {
	throw Object.assign(new Error(message), {
		code: "gateway.invalid_response" as const,
		requestId: null,
		schemaIssueMessage: message,
		schemaIssuePath: "task",
		status: 200,
		upstreamCode: null,
	});
}
