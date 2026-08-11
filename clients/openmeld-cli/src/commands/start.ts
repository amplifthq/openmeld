import { intro } from "@clack/prompts";
import { resolveBaseUrl } from "../config/base-url";
import { setSelectedOpenMeldProfileId } from "../config/openmeld-profile-selection";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { setConfiguredBaseUrl } from "../config/runtime-config";
import { resolveRuntimeContext } from "../runtime/context";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { createPresenter } from "../runtime/presenter/index";
import type { RuntimeContext } from "../runtime/types";
import {
  emitStartCompatibilityNotice,
  emitStartRecap,
  emitStartSetupHint,
  renderStartWelcome,
} from "../start-shell/notices";
import {
  emitStartSelectedProfileWorkspace,
  resolveStartSelectedProfileWorkspace,
} from "../start-shell/profile-workspace";
import { renderOpenMeldHeader } from "../ui/brand";
import {
  ensureStartAuthentication,
  markStartV1Completed,
  runStartDisclaimerStep,
} from "./start-auth-and-readiness";
import { runStartSpaceEntryAction } from "./start-next-action";
import {
  emitStartAgentOverview,
  emitStartSelectionPersistenceWarning,
  ensureDefaultHumanProfile,
  ensureStartAgentIdentityPreflight,
  renderDefaultHumanProfileCard,
  renderSelectedProfile,
  resolveStartSelectedProfile,
  shouldEnsureDefaultHumanProfile,
} from "./start-profile-flow";

type StartInput = {
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
  entryChecksHandled?: boolean;
};

type StartPresenter = ReturnType<typeof createPresenter>;
type StartAuthenticationResult = NonNullable<
  Awaited<ReturnType<typeof ensureStartAuthentication>>
>;

export async function runStart(input: StartInput) {
  const runtime = await resolveRuntimeContext({
    view: input.view,
    profile: input.profile,
  });
  const presenter = createPresenter(runtime);
  const interactive = canUseInteractivePrompts(runtime);

  if (interactive && runtime.resolvedView === "human") {
    intro(`\n${renderOpenMeldHeader()}`);
  }

  if (!input.entryChecksHandled) {
    const disclaimerAccepted = await runStartDisclaimerStep({
      runtime,
      presenter,
      interactive,
    });
    if (!disclaimerAccepted) {
      return;
    }
  }

  emitStartAgentOverview({
    runtime,
    presenter,
  });
  ensureStartAgentIdentityPreflight({
    runtime,
    profile: input.profile,
    profileId: input.profileId,
    kind: input.kind,
    profileName: input.profileName,
    agentName: input.agentName,
  });

  const gatewayUrl = await resolveBaseUrl(input.baseUrl);
  const authentication = await ensureStartAuthentication({
    runtime,
    presenter,
    interactive,
    gatewayUrl,
  });
  if (!authentication) {
    return;
  }

  await persistResolvedGatewayUrl(gatewayUrl);
  const selectedProfile = await resolveStartIdentityProfile({
    input,
    runtime,
    presenter,
    interactive,
    gatewayUrl,
    session: authentication.session,
  });
  if (!selectedProfile) {
    return;
  }

  const selectionResult = await setSelectedOpenMeldProfileId(
    selectedProfile.openMeldProfileId
  );
  renderSelectedProfile({
    runtime,
    presenter,
    profile: selectedProfile,
    selectionPersistent: selectionResult.persistent,
  });
  emitStartSelectionPersistenceWarning({
    presenter,
    runtime,
    selectionPersistent: selectionResult.persistent,
    cliContextSource: selectionResult.cliContextSource,
  });
  const selectedProfileWorkspace = await resolveStartSelectedProfileWorkspace({
    profile: selectedProfile,
  });
  emitStartSelectedProfileWorkspace({
    presenter,
    profile: selectedProfile,
    resolvedView: runtime.resolvedView,
    resolution: selectedProfileWorkspace,
  });

  const nextActionResult = await runStartSpaceEntryAction({
    presenter,
    runtime,
    gatewayUrl,
    profile: selectedProfile,
    interactive,
    view: input.view,
  });
  if (nextActionResult === "cancelled") {
    return;
  }

  emitStartRecap({
    runtime,
    presenter,
    profile: selectedProfile,
  });
  emitStartSetupHint({
    presenter,
    runtime,
  });
  await markStartV1Completed();
}

async function resolveStartIdentityProfile(input: {
  input: StartInput;
  runtime: RuntimeContext;
  presenter: StartPresenter;
  interactive: boolean;
  gatewayUrl: string;
  session: StartAuthenticationResult["session"];
}): Promise<OpenMeldProfile | null> {
  const shouldResolveDefaultHumanProfile = shouldEnsureDefaultHumanProfile({
    resolvedView: input.runtime.resolvedView,
    profile: input.input.profile,
    profileId: input.input.profileId,
    kind: input.input.kind,
    profileName: input.input.profileName,
    agentName: input.input.agentName,
  });
  let defaultHumanProfile: OpenMeldProfile | null = null;

  renderStartWelcome({
    runtime: input.runtime,
    presenter: input.presenter,
    session: input.session,
    gatewayUrl: input.gatewayUrl,
  });
  emitStartCompatibilityNotice({
    input: input.input,
    presenter: input.presenter,
    runtime: input.runtime,
  });

  if (shouldResolveDefaultHumanProfile) {
    defaultHumanProfile = await ensureDefaultHumanProfile({
      presenter: input.presenter,
      runtime: input.runtime,
    });
  }
  if (defaultHumanProfile) {
    renderDefaultHumanProfileCard({
      runtime: input.runtime,
      presenter: input.presenter,
      profile: defaultHumanProfile,
    });
  }

  const selectedProfile = await resolveStartSelectedProfile({
    profile: input.input.profile,
    profileId: input.input.profileId,
    kind: input.input.kind,
    profileName: input.input.profileName,
    agentName: input.input.agentName,
    runtime: input.runtime,
    presenter: input.presenter,
    interactive: input.interactive,
    defaultHumanProfile,
    allowBack: false,
  });
  return selectedProfile === "back" ? null : selectedProfile;
}

async function persistResolvedGatewayUrl(resolved: string): Promise<void> {
  const disablePersist =
    String(process.env.OPENMELD_DISABLE_GATEWAY_PERSIST ?? "").trim() === "1";
  if (!disablePersist) {
    await setConfiguredBaseUrl(resolved);
  }
}
