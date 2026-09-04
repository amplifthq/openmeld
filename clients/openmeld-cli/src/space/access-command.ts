import { resolveBaseUrl } from "../config/base-url";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { resolveOpenMeldProfileOrNull } from "../config/resolve-openmeld-profile";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import { outJsonLine } from "../ui/io";
import {
  emitSpaceAccessAgentOutput,
  emitSpaceAccessHumanOutput,
} from "./access-output";
import { createCliSpaceApi } from "./cli-space-api";
import { assertValidSpaceIdTarget } from "./command-context";

export async function runSpaceAccess(input: {
  baseUrl?: string;
  json: boolean;
  password?: string;
  profile?: string;
  signalId?: string;
  space: string;
  threadRootSignalId?: string;
  view?: string;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  assertValidSpaceIdTarget({
    space: input.space,
    resolvedView: runtime.resolvedView,
  });

  const baseUrl = await resolveBaseUrl(input.baseUrl);
  const openMeldProfile = await resolveOpenMeldProfileOrNull({
    openMeldProfileId: input.profile,
    allowUnauthenticated: true,
    persistSelection: false,
    allowDefaultFallback: false,
  });
  const requestContext = openMeldProfile
    ? buildOpenMeldRequestContextFromProfile({ openMeldProfile })
    : undefined;
  const resolution = await createCliSpaceApi(baseUrl).resolveEntry({
    spaceId: input.space,
    ...(input.signalId ? { signalId: input.signalId } : {}),
    ...(input.threadRootSignalId
      ? { threadRootSignalId: input.threadRootSignalId }
      : {}),
    ...(requestContext ? { requestContext } : {}),
    ...(input.password ? { spacePassword: input.password } : {}),
  });

  if (input.json) {
    outJsonLine(resolution);
    return;
  }
  if (runtime.resolvedView === "agent") {
    emitSpaceAccessAgentOutput({ presenter, resolution });
    return;
  }
  emitSpaceAccessHumanOutput({ presenter, resolution });
}
