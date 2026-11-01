import {
  linearIssuePreviewNamesSchema,
  pluginRuntimeResponseSchema,
} from "@openmeld/schemas";
import type {
  PluginActionRequestIntent,
  PluginActionRequestView,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";

type IssuePreview = NonNullable<PluginActionRequestView["issuePreview"]>;
const UNSAFE_NAME = /[\p{Cc}\p{Cf}]/u;

/** Called only for the recipient's opted-in detail after current access checks.
 * Preview content comes from the saved executable input, never model summaries. */
export async function readPluginIssuePreview(
  env: CoreBindings,
  intent: PluginActionRequestIntent
): Promise<IssuePreview | undefined> {
  const input = intent.recovery?.input;
  const linear =
    intent.service === "linear" &&
    intent.actionId === "linear.create_linear_issue";
  const github =
    intent.service === "github" && intent.actionId === "github.create_issue";
  if (!(input && (linear || github))) {
    return;
  }
  const targets: IssuePreview["targets"] = [];
  if (linear) {
    for (const [label, field] of [
      ["Team", "teamId"],
      ["Project", "projectId"],
    ] as const) {
      const id = intent.input[field];
      if (typeof id === "string") {
        targets.push({ label, id, name: null });
      }
    }
    await resolveLinearNames(env, intent.connection.connectionName, targets);
  } else {
    const { owner, repo } = intent.input;
    if (typeof owner === "string" && typeof repo === "string") {
      targets.push({
        label: "Repository",
        id: `${owner}/${repo}`,
        name: `${owner}/${repo}`,
      });
    }
  }
  const visibleFields = new Set(
    linear
      ? ["title", "description", "team_id", "teamId", "project_id", "projectId"]
      : ["title", "body", "owner", "repo"]
  );
  const description = linear ? input.description : input.body;
  return {
    title: typeof input.title === "string" ? input.title : null,
    description: typeof description === "string" ? description : "",
    targets,
    additionalFieldCount: Object.keys(input).filter(
      (key) => !visibleFields.has(key)
    ).length,
  };
}

async function resolveLinearNames(
  env: CoreBindings,
  connectionName: string,
  targets: IssuePreview["targets"]
) {
  const team = targets.find((target) => target.label === "Team");
  const project = targets.find((target) => target.label === "Project");
  if (!team) {
    return;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // OpenConnector linear.run_query returns the provider GraphQL envelope.
    // Fixed read-only query and exact IDs; no model text becomes query code.
    const result = await Promise.race([
      env.OPENMELD_REMOTE_AGENT_WORKER?.pluginRuntime?.({
        operation: "execute",
        service: "linear",
        actionId: "linear.run_query",
        connectionName,
        authorizedEffect: "read",
        idempotencyKey: crypto.randomUUID(),
        input: {
          query: `query ApprovalDestination($teamId: String!${project ? ", $projectId: String!" : ""}) { team(id: $teamId) { id name }${project ? " project(id: $projectId) { id name }" : ""} }`,
          variables: {
            teamId: team.id,
            ...(project ? { projectId: project.id } : {}),
          },
        },
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("deadline")), 4000);
      }),
    ]);
    const runtime = pluginRuntimeResponseSchema.safeParse(result);
    const names =
      runtime.success && runtime.data.status === "completed"
        ? linearIssuePreviewNamesSchema.safeParse(runtime.data.data).data?.data
        : undefined;
    if (!names) {
      throw new Error("provider_unavailable");
    }
    for (const [target, resource] of [
      [team, names.team],
      [project, names.project],
    ] as const) {
      if (
        target &&
        resource?.id === target.id &&
        !UNSAFE_NAME.test(resource.name)
      ) {
        target.name = resource.name;
      }
    }
  } catch {
    // Name availability is presentation, never approval or execution authority.
    // Keep exact IDs visible and explicitly label missing names in the client.
    console.warn("[plugin.request.issue_preview_names_unavailable]", {
      service: "linear",
    });
  } finally {
    clearTimeout(timeout);
  }
}
