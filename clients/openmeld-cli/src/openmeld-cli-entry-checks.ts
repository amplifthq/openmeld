import { getCommandCheckRequirements } from "./command-entry-checks/command-check-requirements";
import { resolveCommandEntryNameFromTokens } from "./command-entry-checks/command-entry-name";
import {
  finishCurrentCommandCheckScope,
  startCurrentCommandCheckScope,
} from "./command-entry-checks/current-command-check-state";
import { applyEntryCheckResult } from "./command-entry-checks/entry-check-blocked-json";
import { runCommandEntryFlow } from "./command-entry-checks/run-command-entry-flow";
import type { CommandCheckMode } from "./command-entry-checks/types";
import {
  resolveBaseUrlOrNull,
  resolveExplicitGatewayUrlOrThrow,
} from "./config/base-url";
import { resolveOpenMeldEnvironmentTarget } from "./config/openmeld-environment-target";
import { resolveRuntimeContext } from "./runtime/context";
import { createPresenter } from "./runtime/presenter/index";
import { createSilentPresenter } from "./runtime/presenter/silent";
import { hasJsonOutputArgv } from "./runtime/view-argv";

export async function runCommandWithEntryChecks(input: {
  routeTokens: string[];
  view?: string;
  profile?: string;
  gatewayUrl?: string;
  jsonOutput?: boolean;
  run: () => Promise<void>;
}): Promise<void> {
  const entryName = resolveCommandEntryNameFromTokens(input.routeTokens);
  if (!entryName) {
    throw new Error(
      `missing command entry mapping for route: ${input.routeTokens.join(" ")}`
    );
  }
  const jsonOutput = input.jsonOutput ?? hasJsonOutputArgv(process.argv);
  const requirements = getCommandCheckRequirements(entryName);
  const environmentTarget = await resolveOpenMeldEnvironmentTarget({
    gatewayUrl: input.gatewayUrl,
  });
  const normalizedGatewayUrl = await resolveGatewayUrlForEntryChecks({
    entryName,
    gatewayUrl: input.gatewayUrl,
    signInMode: requirements.signIn.mode,
  });

  const runtime = await resolveRuntimeContext({
    ...(input.view ? { view: input.view } : {}),
    ...(input.profile ? { profile: input.profile } : {}),
  });
  const presenter = jsonOutput
    ? createSilentPresenter(runtime.resolvedView)
    : createPresenter(runtime);
  startCurrentCommandCheckScope();
  try {
    const result = await runCommandEntryFlow({
      entryName,
      argv: process.argv,
      runtime,
      presenter,
      allowPrompt: runtime.interactive,
      environmentTarget,
      gatewayUrl: normalizedGatewayUrl,
      profileArg: normalizeOptionalString(input.profile),
      jsonOutput,
    });
    if (applyEntryCheckResult({ result, jsonOutput })) {
      await input.run();
    }
  } finally {
    finishCurrentCommandCheckScope();
  }
}

export function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

async function resolveGatewayUrlForEntryChecks(input: {
  entryName: string;
  gatewayUrl?: string;
  signInMode: CommandCheckMode;
}): Promise<string | null> {
  const explicitGatewayUrl = await resolveExplicitGatewayUrlOrThrow(
    input.gatewayUrl
  );
  if (explicitGatewayUrl) {
    return explicitGatewayUrl;
  }
  if (input.entryName === "start" || input.signInMode === "skip") {
    return null;
  }
  return await resolveBaseUrlOrNull();
}
