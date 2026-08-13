import { cancel, confirm, isCancel } from "@clack/prompts";
import type { SpaceMeta } from "@openmeld/protocol";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import type { createPresenter } from "../runtime/presenter/index";
import {
  buildPublicSpaceJoinConfirmPromptConfig,
  type PublicSpaceExposure,
  resolvePublicSpaceExposure,
} from "../ui/public-space-warning";
import { fetchSpaceMeta } from "./meta-api";
import { runSpacePasswordRetry } from "./password-flow";

export type SpaceJoinAccessBootstrapResult =
  | {
      status: "ready";
      password?: string;
      spaceMeta: SpaceMeta;
      publicExposure: PublicSpaceExposure | null;
    }
  | {
      status: "cancelled";
    };

type JoinAccessBootstrapPresenter = Pick<
  ReturnType<typeof createPresenter>,
  "line"
>;

// Join access bootstrap owns password/meta/public-space truth only.
// Membership flow and connect handoff start after this returns ready.
export async function resolveSpaceJoinAccessBootstrap(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  space: string;
  initialPassword?: string;
  resolvedView: "human" | "agent";
  presenter: JoinAccessBootstrapPresenter;
  canPromptJoinPassword: boolean;
  canConfirmPublicSpaceJoin: boolean;
}): Promise<SpaceJoinAccessBootstrapResult> {
  const accessState = await resolveJoinAccessState({
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    space: input.space,
    initialPassword: input.initialPassword,
    presenter: input.presenter,
    canPromptJoinPassword: input.canPromptJoinPassword,
  });
  if (accessState.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }

  const publicExposure = resolvePublicSpaceExposure(accessState.spaceMeta);
  const confirmedPublicSpace = await confirmPublicSpaceJoinAccess({
    publicExposure,
    resolvedView: input.resolvedView,
    canConfirmPublicSpaceJoin: input.canConfirmPublicSpaceJoin,
  });
  if (!confirmedPublicSpace) {
    return {
      status: "cancelled",
    };
  }

  return {
    status: "ready",
    password: accessState.password,
    spaceMeta: accessState.spaceMeta,
    publicExposure,
  };
}

async function resolveJoinAccessState(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  space: string;
  initialPassword?: string;
  presenter: JoinAccessBootstrapPresenter;
  canPromptJoinPassword: boolean;
}): Promise<
  | {
      status: "ready";
      password?: string;
      spaceMeta: SpaceMeta;
    }
  | {
      status: "cancelled";
    }
> {
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile: input.openMeldProfile,
  });
  const accessResult = await runSpacePasswordRetry({
    initialPassword: input.initialPassword,
    interactive: input.canPromptJoinPassword,
    presenter: input.presenter,
    codePrefix: "space.join.password",
    execute: async (password) =>
      await fetchSpaceMeta({
        requestContext,
        baseUrl: input.baseUrl,
        space: input.space,
        password,
      }),
  });
  if (accessResult.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }

  return {
    status: "ready",
    password: accessResult.password,
    spaceMeta: accessResult.result,
  };
}

async function confirmPublicSpaceJoinAccess(input: {
  publicExposure: PublicSpaceExposure | null;
  resolvedView: "human" | "agent";
  canConfirmPublicSpaceJoin: boolean;
}): Promise<boolean> {
  if (!input.publicExposure) {
    return true;
  }
  if (input.resolvedView !== "human") {
    return true;
  }
  if (!input.canConfirmPublicSpaceJoin) {
    throw new Error(
      "This Space can be read by anyone with the link. Re-run this command in an interactive terminal so you can confirm before joining."
    );
  }

  const confirmed = await confirm({
    ...buildPublicSpaceJoinConfirmPromptConfig({
      exposure: input.publicExposure,
    }),
    initialValue: true,
  });
  if (isCancel(confirmed)) {
    cancel("Cancelled.");
    return false;
  }
  return confirmed;
}
