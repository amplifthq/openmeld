import { cancel, note } from "@clack/prompts";
import {
  getConfiguredOnboardingDisclaimerAcceptedAt,
  updateConfiguredOnboardingConfig,
} from "../config/runtime-config";
import type { createPresenter } from "../runtime/presenter/index";
import type { RuntimeContext } from "../runtime/types";
import type { InteractivePromptStreams } from "../ui/interactive-prompt";
import { promptSearchSelect } from "../ui/search-select";

export const OPENMELD_ACCEPT_DISCLAIMER_ENV = "OPENMELD_ACCEPT_DISCLAIMER";
export const OPENMELD_ONBOARDING_DISCLAIMER_ACCEPT =
  "__onboarding_disclaimer_accept__";
export const OPENMELD_ONBOARDING_DISCLAIMER_DECLINE =
  "__onboarding_disclaimer_decline__";
export const OPENMELD_ONBOARDING_DISCLAIMER_TEXT =
  "OpenMeld local service is experimental and changes rapidly. Breaking changes may occur. You are fully responsible for data security and sensitive information handling. Use OpenMeld only in trusted environments.";

type OnboardingDisclaimerPresenter = ReturnType<typeof createPresenter>;

export async function runOnboardingDisclaimerGate(input: {
  runtime: RuntimeContext;
  presenter: OnboardingDisclaimerPresenter;
  interactive: boolean;
  codePrefix: string;
  streams?: InteractivePromptStreams;
}): Promise<boolean> {
  const acceptedAt = await getConfiguredOnboardingDisclaimerAcceptedAt().catch(
    () => null
  );
  if (acceptedAt) {
    return true;
  }

  if (shouldBypassDisclaimerWithEnv()) {
    await persistOnboardingDisclaimerAccepted();
    return true;
  }

  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: input.codePrefix,
      payload: {
        acceptedAt: null,
        text: OPENMELD_ONBOARDING_DISCLAIMER_TEXT,
        mode: "agent_notice",
        requiresConfirmation: false,
      },
    });
    await persistOnboardingDisclaimerAccepted();
    return true;
  }

  note(`⚠️ ${OPENMELD_ONBOARDING_DISCLAIMER_TEXT}`, "Disclaimer");
  if (!input.interactive) {
    input.presenter.line({
      code: `${input.codePrefix}.auto_continue`,
      text: "Non-interactive session: disclaimer displayed and OpenMeld continues.",
    });
    await persistOnboardingDisclaimerAccepted();
    return true;
  }

  const decision = await promptSearchSelect(
    {
      message: "Do you accept and continue?",
      items: [
        {
          value: OPENMELD_ONBOARDING_DISCLAIMER_ACCEPT,
          label: "Yes, continue",
        },
        {
          value: OPENMELD_ONBOARDING_DISCLAIMER_DECLINE,
          label: "No, exit",
        },
      ],
      maxVisible: 2,
    },
    input.streams
  );

  if (
    decision.status !== "submitted" ||
    decision.value !== OPENMELD_ONBOARDING_DISCLAIMER_ACCEPT
  ) {
    cancel("Cancelled.");
    return false;
  }

  await persistOnboardingDisclaimerAccepted();
  return true;
}

function shouldBypassDisclaimerWithEnv(): boolean {
  return (
    String(process.env[OPENMELD_ACCEPT_DISCLAIMER_ENV] ?? "").trim() === "1"
  );
}

async function persistOnboardingDisclaimerAccepted(): Promise<void> {
  const acceptedAt = new Date().toISOString();
  await updateConfiguredOnboardingConfig((current) => ({
    ...(current ?? {}),
    disclaimerAcceptedAt: acceptedAt,
  }));
}
