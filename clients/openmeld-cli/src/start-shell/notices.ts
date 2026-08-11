import { note } from "@clack/prompts";
import pc from "picocolors";
import type { StoredAuthSession } from "../config/auth-session";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
} from "../runtime/cli-entry-command";
import type { createPresenter } from "../runtime/presenter/index";
import type { RuntimeContext } from "../runtime/types";
import {
  buildStartNextActionCommands,
  buildStartRecapItems,
} from "./next-action-commands";

type StartPresenter = ReturnType<typeof createPresenter>;

export type StartCompatibilityInput = {
  profile?: string;
  profileId?: string;
  kind?: string;
  profileName?: string;
  agentName?: string;
  agentModel?: string;
  agentOwner?: string;
  baseUrl?: string;
  view?: string;
  skillsMode?: string;
};

export function renderStartWelcome(input: {
  runtime: RuntimeContext;
  presenter: StartPresenter;
  session: StoredAuthSession;
  gatewayUrl: string;
}): void {
  const email =
    normalizeOptionalString(input.session.user?.email) ?? "(unknown)";

  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "start.welcome",
      payload: {
        email,
        gatewayUrl: input.gatewayUrl,
      },
    });
    return;
  }

  note(
    [`Signed In: ${email}`, `Gateway: ${input.gatewayUrl}`].join("\n"),
    "Welcome"
  );
}

export function emitStartCompatibilityNotice(input: {
  input: StartCompatibilityInput;
  presenter: StartPresenter;
  runtime: RuntimeContext;
}): void {
  const normalizedSkillsMode = normalizeOptionalString(
    input.input.skillsMode
  )?.toLowerCase();
  const ignoredFlags = [
    normalizeOptionalString(input.input.agentModel) ? "--agent-model" : null,
    normalizeOptionalString(input.input.agentOwner) ? "--agent-owner" : null,
    normalizedSkillsMode && normalizedSkillsMode !== "auto"
      ? "--skills-mode"
      : null,
  ].filter((value): value is string => value !== null);
  if (ignoredFlags.length === 0) {
    return;
  }

  const message = `start ignores ${ignoredFlags.join(", ")} in OpenMeld profile mode`;
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "start.compatibility.notice",
      payload: {
        message,
      },
    });
    return;
  }

  note(message, "Start Compatibility", {
    format: (value) => value,
  });
}

export function emitStartRecap(input: {
  runtime: RuntimeContext;
  presenter: StartPresenter;
  profile?: OpenMeldProfile;
}): void {
  const recapItems = buildStartRecapItems();
  if (input.runtime.resolvedView === "agent") {
    const nextCommands = input.profile
      ? buildStartNextActionCommands({
          openMeldProfileId: input.profile.openMeldProfileId,
          resolvedView: input.runtime.resolvedView,
        })
      : recapItems.map((item) => item.command);
    input.presenter.data({
      code: "start.recap",
      payload: {
        nextCommands,
      },
    });
    return;
  }

  const recapLines = [
    "Each command below can be run on its own any time.",
    "",
    ...recapItems.flatMap((item) => [
      item.command,
      pc.dim(`  ${item.description}`),
    ]),
  ];

  note(recapLines.join("\n"), "Recap", {
    format: (value) => value,
  });
}

export function emitStartSetupHint(input: {
  presenter: StartPresenter;
  runtime: RuntimeContext;
}): void {
  const command =
    input.runtime.resolvedView === "agent"
      ? formatOpenMeldCliCommand("openmeld setup --view agent")
      : formatOpenMeldCliCommand("openmeld setup");
  const payload = {
    command,
    optional: true,
    reason: "Use setup when this computer needs local service or agent setup.",
  };
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "start.setup.hint",
      payload,
    });
    return;
  }

  input.presenter.line({
    code: "start.setup.hint",
    text: formatInlineOpenMeldCliCommands(
      "If this computer needs local service or agent setup, run `openmeld setup`."
    ),
  });
}

function normalizeOptionalString(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
