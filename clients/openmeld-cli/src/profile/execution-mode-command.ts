import { createAgentProfileExecutionModeApi } from "@openmeld/api-client";
import { resolveBaseUrl } from "../config/base-url";
import { resolveOpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter";
import { createCliApiClientFoundation } from "../space/api-client-foundation";

export async function runProfileExecutionMode(input: {
  profile: string;
  mode?: string;
  view?: string;
}): Promise<void> {
  if (
    input.mode !== undefined &&
    input.mode !== "parallel" &&
    input.mode !== "serial"
  ) {
    throw new Error("--mode must be parallel or serial.");
  }
  const profile = await resolveOpenMeldProfile({
    openMeldProfileId: input.profile,
    profileKind: "agent",
  });
  if (!profile || profile.profileKind !== "agent") {
    throw new Error("Choose an Agent Profile you own.");
  }
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  const result = await createAgentProfileExecutionModeApi(
    createCliApiClientFoundation(await resolveBaseUrl())
  ).readOrUpdate({
    agentProfileId: profile.openMeldProfileId,
    mode: input.mode,
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: profile,
    }),
  });
  if (runtime.resolvedView === "agent") {
    presenter.data({ code: "profile.execution_mode", payload: result });
    return;
  }
  presenter.line({
    code: "profile.execution_mode",
    text: `${profile.profileName}: ${result.mode} admission; Context migration ${result.migration}. Existing tasks retain their execution and conversation identity.`,
  });
}
