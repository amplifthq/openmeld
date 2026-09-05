import type { GetSpaceEntryResolutionResponse } from "@openmeld/schemas/types";
import type { Presenter } from "../runtime/presenter";

export function emitSpaceAccessAgentOutput(input: {
  presenter: Presenter;
  resolution: GetSpaceEntryResolutionResponse;
}): void {
  input.presenter.data({
    code: "space.access.resolved",
    payload: {
      resolution: input.resolution,
      viewAction: resolveAgentViewAction(input.resolution),
    },
  });
}

export function emitSpaceAccessHumanOutput(input: {
  presenter: Presenter;
  resolution: GetSpaceEntryResolutionResponse;
}): void {
  const { resolution } = input;
  const spaceLabel = resolution.safeContext.spaceName ?? "this Space";

  if (resolution.view.state === "allowed") {
    input.presenter.line({
      code: "space.access.allowed",
      text:
        resolution.view.experience === "public"
          ? `${spaceLabel} is available to read publicly.`
          : `You can open ${spaceLabel}.`,
    });
    if (resolution.participation.state === "self_join_available") {
      input.presenter.line({
        code: "space.access.join_available",
        text: "You can read it now and join when you want to participate.",
      });
    }
    return;
  }

  if (resolution.view.state === "sign_in_required") {
    input.presenter.line({
      code: "space.access.sign_in_required",
      text: "Sign in to check access to this Space.",
    });
    input.presenter.line({
      code: "space.access.next",
      text: "Next: openmeld auth login",
    });
    return;
  }

  if (resolution.view.state === "password_required") {
    input.presenter.line({
      code: "space.access.password_required",
      text: "This Space requires a password.",
    });
    input.presenter.line({
      code: "space.access.next",
      text: "Rerun this command with --password <space-password>.",
    });
    return;
  }

  if (resolution.view.state === "membership_required") {
    input.presenter.line({
      code: "space.access.membership_required",
      text: `You don't have access to ${spaceLabel}.`,
    });
    const ownerName = resolution.safeContext.owner?.displayName;
    input.presenter.line({
      code: "space.access.next",
      text: ownerName
        ? `Ask ${ownerName} to add you to this Space.`
        : "Ask a Space owner to add you.",
    });
    return;
  }

  input.presenter.line({
    code: "space.access.unavailable",
    text: "This Space isn't available to this account.",
  });
}

function resolveAgentViewAction(
  resolution: GetSpaceEntryResolutionResponse
): Record<string, unknown> {
  switch (resolution.view.state) {
    case "allowed":
      return {
        kind: "continue_to_target",
        target: resolution.target,
      };
    case "sign_in_required":
      return {
        kind: "sign_in",
        command: "openmeld auth login --view agent",
      };
    case "password_required":
      return {
        kind: "provide_password",
        command:
          "openmeld space access <space-url-or-id> --password <space-password> --view agent",
      };
    case "membership_required":
      return {
        kind: "contact_space_owner",
        ...(resolution.safeContext.owner
          ? { owner: resolution.safeContext.owner }
          : {}),
      };
    case "unavailable":
      return { kind: "unavailable" };
    default:
      return assertUnreachable(resolution.view);
  }
}

function assertUnreachable(value: never): never {
  throw new Error(`unsupported Space entry view: ${JSON.stringify(value)}`);
}
