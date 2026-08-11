import { getProfileDefaultView } from "./config/profile-view";
import { resolveViewProfileKey } from "./config/view-profile-key";
import { canShowAgentViewRecoveryPrompt } from "./openmeld-cli-error-output";
import { resolveRuntimeContext } from "./runtime/context";
import {
  parseViewFromArgv,
  shouldUseAgentViewForNonInteractiveStart,
} from "./runtime/view-argv";

export function getGlobalViewOption(): string | undefined {
  const explicit = parseViewFromArgv(process.argv);
  if (explicit !== null) {
    return explicit;
  }

  if (
    shouldUseAgentViewForNonInteractiveStart(
      process.argv,
      canShowAgentViewRecoveryPrompt()
    )
  ) {
    return "agent";
  }
  return undefined;
}

export function stripViewArgs(args: string[]): string[] {
  const out: string[] = [];
  let skipNext = false;

  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (arg === "--view") {
      skipNext = true;
      continue;
    }

    if (arg.startsWith("--view=")) {
      continue;
    }

    if (arg === "--service-auto-install") {
      skipNext = true;
      continue;
    }

    if (arg.startsWith("--service-auto-install=")) {
      continue;
    }

    out.push(arg);
  }

  return out;
}

export async function resolveEffectiveViewForOutput(): Promise<
  "human" | "agent"
> {
  const explicitView = parseViewFromArgv(process.argv, {
    allowMissingValue: true,
  });
  if (explicitView === "human" || explicitView === "agent") {
    return explicitView;
  }

  const configuredView = await readConfiguredDefaultView({
    argv: process.argv,
  });
  const selectedView = configuredView;

  if (selectedView === "human" || selectedView === "agent") {
    return selectedView;
  }

  return (await resolveRuntimeContext({ view: "auto" })).resolvedView;
}

export function resolveEffectiveViewForError(
  argv: string[]
): Promise<"auto" | "human" | "agent"> {
  return resolveEffectiveViewForErrorInternal(argv).catch(() => "auto");
}

async function resolveEffectiveViewForErrorInternal(
  argv: string[]
): Promise<"auto" | "human" | "agent"> {
  let explicit: "auto" | "human" | "agent" | null = null;
  try {
    explicit = parseViewFromArgv(argv);
  } catch {
    // Fall back to configured view so error handling can continue.
  }

  if (explicit === "human" || explicit === "agent") {
    return explicit;
  }

  const configured = await readConfiguredDefaultView({ argv });
  if (configured === "human" || configured === "agent") {
    return configured;
  }

  const profile = parseProfileFromArgv(argv);
  return (
    await resolveRuntimeContext({
      view: "auto",
      profile,
    })
  ).resolvedView;
}

export async function readConfiguredDefaultView(input?: {
  profile?: string;
  argv?: string[];
}): Promise<"auto" | "human" | "agent"> {
  const argv = input?.argv ?? process.argv;
  const profileArg = input?.profile ?? parseProfileFromArgv(argv);
  const viewOpenMeldProfileId = await resolveViewProfileKey(profileArg);
  if (!viewOpenMeldProfileId) {
    return "auto";
  }
  return getProfileDefaultView(viewOpenMeldProfileId).catch(() => "auto");
}

function parseProfileFromArgv(argv: string[]): string | undefined {
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== "string") {
      continue;
    }
    if (arg === "--") {
      break;
    }
    if (arg === "--profile") {
      const next = argv[i + 1];
      if (
        typeof next === "string" &&
        next.length > 0 &&
        !next.startsWith("-")
      ) {
        return next;
      }
      continue;
    }
    if (arg.startsWith("--profile=")) {
      const value = arg.slice("--profile=".length).trim();
      if (value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}
