import { buildAgentFacingPublicationModeGuideLines } from "@openmeld/space-mesh";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthLoginGuideError,
  createDoctorFailedGuideError,
  createProfileActionGuideError,
  createProfileCreateGuideError,
  createResetConfirmationGuideError,
  createSpaceAddMembersCurrentProfileGuideError,
  createSpaceAddMembersGuideError,
  createSpaceAgentProfileOnlyGuideError,
  createSpaceAliasTargetGuideError,
  createSpaceContractSetGuideError,
  createSpaceProfileRequiredGuideError,
  createSpacePublicationSetGuideError,
  createSpaceRemoveMembersCreatorGuideError,
  createSpaceRemoveMembersCurrentProfileGuideError,
  createSpaceRemoveMembersGuideError,
  createSpaceResultGuideError,
  createSpaceSendInputConflictGuideError,
  createSpaceSendInputEmptyGuideError,
  createSpaceSendInputFileReadFailedGuideError,
  createSpaceSubcommandTargetGuideError,
  createSpaceTargetGuideError,
  createSpaceUpdatesGuideError,
  createStartAgentIdentityGuideError,
  createStartAuthenticationGuideError,
  createUpgradeConfirmationGuideError,
} from "../src/runtime/dual-view-guide-catalog";

describe("dual view guide catalog", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds send alias guide for agent view", () => {
    const guideError = createSpaceAliasTargetGuideError("send");
    expect(guideError.message).toContain(
      "openmeld send requires explicit --space argument in agent view."
    );
    expect(guideError.message).toContain("[FOR HUMAN OPERATORS]");
    expect(guideError.message).toContain("[FOR AGENTS]");
    expect(guideError.message).toContain("--space <space-id>");
    expect(guideError.message).toContain(
      "openmeld space [--gateway-url <url>] send [--profile <profile-id>] <space-id> [<text...>|--stdin|--text-file <path>] [--file <path>...]"
    );
  });

  it("builds reset confirmation guide for agent view", () => {
    const guideError = createResetConfirmationGuideError();
    expect(guideError.message).toContain(
      "openmeld reset in agent view requires explicit confirmation flag."
    );
    expect(guideError.message).toContain("openmeld reset --yes");
    expect(guideError.message).toContain("[FOR HUMAN OPERATORS]");
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds upgrade confirmation guide for version-check failure", () => {
    const guideError = createUpgradeConfirmationGuideError("check_failed");
    expect(guideError.message).toContain(
      "openmeld upgrade in agent view requires --yes when version check fails."
    );
    expect(guideError.message).toContain("openmeld upgrade --check");
    expect(guideError.message).toContain("[FOR HUMAN OPERATORS]");
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds start authentication guide for agent view", () => {
    const guideError = createStartAuthenticationGuideError();
    expect(guideError.message).toContain(
      "openmeld start requires sign-in before OpenMeld profile selection."
    );
    expect(guideError.message).toContain(
      "openmeld login --view agent --method ott"
    );
    expect(guideError.message).toContain("[FOR HUMAN OPERATORS]");
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds start agent identity guide with explicit constraints", () => {
    const guideError = createStartAgentIdentityGuideError();
    expect(guideError.message).toContain(
      "openmeld start in agent view requires explicit agent profile selection or creation arguments."
    );
    expect(guideError.message).toContain(
      "openmeld start --view agent --profile-id"
    );
    expect(guideError.message).toContain(
      "creating profiles never accepts custom profile IDs"
    );
    expect(guideError.message).toContain(
      "openmeld space create --profile <agent-profile-id> --name <space-name> --view agent"
    );
    expect(guideError.message).toContain(
      "openmeld start in agent view selects or creates an Agent Profile and returns Space commands."
    );
    expect(guideError.message).toContain("openmeld setup --view agent");
    expect(guideError.message).toContain("[FOR HUMAN OPERATORS]");
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds auth login argument guide with detailed reason", () => {
    const guideError = createAuthLoginGuideError(
      "invalid --method value: use device|ott"
    );
    expect(guideError.message).toContain(
      "openmeld auth login: invalid --method value: use device|ott"
    );
    expect(guideError.message).toContain(
      "one explicit automation path: --ott <token> | --method device"
    );
    expect(guideError.message).toContain("--method <device|ott>");
    expect(guideError.message).toContain(
      "openmeld login --ott <token> --view agent"
    );
    expect(guideError.message).toContain("[FOR HUMAN OPERATORS]");
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds space agent profile-only guide with explicit rejection context", () => {
    const guideError = createSpaceAgentProfileOnlyGuideError({
      profileId: "hum_felix",
      profileKind: "human",
    });
    expect(guideError.message).toContain(
      "this Space operation requires an Agent Profile"
    );
    expect(guideError.message).toContain("received human:hum_felix");
    expect(guideError.message).toContain(
      "First run `openmeld profiles list --view agent` to find an agent profile ID."
    );
    expect(guideError.message).toContain(
      "Then rerun the space command with `--profile <agent-profile-id>`."
    );
    expect(guideError.message).toContain(
      "`--view agent` controls output format."
    );
    expect(guideError.message).toContain("openmeld profiles list --view agent");
    expect(guideError.message).toContain("[FOR HUMAN OPERATORS]");
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds doctor failure guide for agent view", () => {
    const guideError = createDoctorFailedGuideError();
    expect(guideError.message).toContain(
      "openmeld doctor detected one or more failed checks."
    );
    expect(guideError.message).toContain("doctor.check.fail");
    expect(guideError.message).toContain("[FOR HUMAN OPERATORS]");
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds space password argument guide for agent view", () => {
    const guideError = createSpaceSubcommandTargetGuideError("password");
    expect(guideError.message).toContain(
      "openmeld space password needs a space ID and one action (--password or --clear) in agent view."
    );
    expect(guideError.message).toContain(
      "one action: --password <value> | --clear"
    );
    expect(guideError.message).toContain(
      'Select "Configure a space" -> "Password" and pick the target space by name'
    );
    expect(guideError.message).toContain(
      "openmeld space [--gateway-url <url>] list [--profile <profile-id>] [--limit <n>] [--json]"
    );
    expect(guideError.message).toContain(
      "openmeld space [--gateway-url <url>] password [--profile <profile-id>] <space-id> (--password <value>|--clear)"
    );
    expect(guideError.message).toContain("[FOR HUMAN OPERATORS]");
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds space contract target guide for agent view", () => {
    const guideError = createSpaceTargetGuideError("contract");
    expect(guideError.message).toContain(
      "openmeld space contract requires explicit space target in agent view."
    );
    expect(guideError.message).toContain(
      "openmeld space [--gateway-url <url>] contract [--profile <profile-id>] <space-id> [--json] [--password <value>]"
    );
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds space contract set guide for agent view", () => {
    const guideError = createSpaceContractSetGuideError();
    expect(guideError.message).toContain(
      "openmeld space contract set needs an explicit space ID and at least one patch field in agent view."
    );
    expect(guideError.message).toContain(
      "[--dispatch-policy <mention_only|listen_all>]"
    );
    expect(guideError.message).toContain(
      "openmeld space [--gateway-url <url>] contract set [--profile <profile-id>] <space-id>"
    );
    expect(guideError.message).not.toContain(
      "<space-id> --dispatch-policy <mention_only|listen_all>"
    );
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds space publication set guide from shared publication guidance", () => {
    const guideError = createSpacePublicationSetGuideError();
    expect(guideError.message).toContain(
      "openmeld space publication set needs an explicit space ID, mode, and Space password."
    );
    expect(guideError.message).toContain(
      "openmeld space publication set <space-id> <collaboration|transparent> --password <space-password>"
    );
    for (const line of buildAgentFacingPublicationModeGuideLines()) {
      expect(guideError.message).toContain(line);
    }
  });

  it("builds space status target guide for agent view", () => {
    const guideError = createSpaceTargetGuideError("status");
    expect(guideError.message).toContain(
      "openmeld space status requires explicit space target in agent view."
    );
    expect(guideError.message).toContain(
      "openmeld space [--gateway-url <url>] status [--profile <profile-id>] <space-id> [--json] [--password <value>]"
    );
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds space updates guide for agent view", () => {
    const guideError = createSpaceUpdatesGuideError();
    expect(guideError.message).toContain(
      "openmeld space updates needs an explicit space ID and --after-signal anchor in agent view."
    );
    expect(guideError.message).toContain("--after-signal <signal-id>");
    expect(guideError.message).toContain(
      "openmeld space [--gateway-url <url>] updates [--profile <profile-id>] <space-id> --after-signal <signal-id> [--limit <n>] [--json] [--password <value>]"
    );
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds space result guide for agent view", () => {
    const guideError = createSpaceResultGuideError();
    expect(guideError.message).toContain(
      "openmeld space result needs an explicit space ID and exactly one selector in agent view."
    );
    expect(guideError.message).toContain(
      "one selector: --dispatch <dispatch-id> | --result-ref <result-ref>"
    );
    expect(guideError.message).toContain(
      "openmeld space [--gateway-url <url>] result [--profile <profile-id>] <space-id> --dispatch <dispatch-id> [--json] [--password <value>]"
    );
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds space profile required guide with create and explicit profile recovery", () => {
    const guideError = createSpaceProfileRequiredGuideError();
    expect(guideError.message).toContain(
      "No selected OpenMeld profile is available for this command in the current OpenMeld CLI context."
    );
    expect(guideError.message).toContain(
      "openmeld profiles create <profile-name> --kind agent --view agent"
    );
    expect(guideError.message).toContain(
      "openmeld profiles set <profile-id> --view agent"
    );
    expect(guideError.message).toContain(
      "openmeld space create --profile <profile-id> --name <space-name> --view agent"
    );
  });

  it("builds profile create guide with explicit space follow-ups", () => {
    const guideError = createProfileCreateGuideError(
      "missing required kind argument"
    );
    expect(guideError.message).toContain(
      "openmeld profiles create <profileName> --kind agent --view agent"
    );
    expect(guideError.message).toContain(
      "openmeld space create --profile <profile-id> --name <space-name> --view agent"
    );
    expect(guideError.message).toContain(
      "openmeld space join --profile <profile-id> <space-id> --view agent"
    );
  });

  it("builds add-members argument guide for agent/non-interactive mode", () => {
    const guideError = createSpaceAddMembersGuideError();
    expect(guideError.message).toContain(
      "openmeld space add-members in agent/non-interactive mode requires explicit space and member arguments."
    );
    expect(guideError.message).toContain("--password <value>");
    expect(guideError.message).toContain(
      "one selection mode: --member <profile-id...> | --all"
    );
    expect(guideError.message).toContain(
      "space is single-select; profiles support one or many selections."
    );
    expect(guideError.message).toContain(
      "openmeld space add-members --profile <profile-id> <space-id> --member <profile-id...> --view agent"
    );
    expect(guideError.message).toContain(
      "openmeld space add-members --profile <profile-id> <space-id> --all --view agent"
    );
    expect(guideError.message).toContain("[FOR HUMAN OPERATORS]");
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("builds add-agents argument guide for agent/non-interactive mode", () => {
    const guideError = createSpaceAddMembersGuideError(
      undefined,
      "space.add-agents"
    );
    expect(guideError.message).toContain(
      "openmeld space add-agents in agent/non-interactive mode requires explicit space and Agent Profile arguments."
    );
    expect(guideError.message).toContain(
      "one selection mode: --agent-profile <agent-profile-id...> | --all"
    );
    expect(guideError.message).toContain(
      "openmeld space add-agents --profile <profile-id> <space-id> --agent-profile <agent-profile-id...> --view agent"
    );
    expect(guideError.message).toContain(
      "Adding a profile to a Space does not prove Agent Profile readiness."
    );
  });

  it("builds add-human-profiles argument guide for agent/non-interactive mode", () => {
    const guideError = createSpaceAddMembersGuideError(
      undefined,
      "space.add-human-profiles"
    );
    expect(guideError.message).toContain(
      "openmeld space add-human-profiles in agent/non-interactive mode requires explicit space and Human Profile arguments."
    );
    expect(guideError.message).toContain(
      "one selection mode: --human-profile <human-profile-id...> | --all"
    );
    expect(guideError.message).toContain(
      "openmeld space add-human-profiles --profile <profile-id> <space-id> --human-profile <human-profile-id...> --view agent"
    );
    expect(guideError.message).toContain(
      "Adding a profile to a Space does not prove Agent Profile readiness."
    );
  });

  it("builds current-profile add-members guide that redirects to join", () => {
    const guideError = createSpaceAddMembersCurrentProfileGuideError({
      profileId: "agt_current",
    });
    expect(guideError.message).toContain(
      "Current profile joins a space with `openmeld space join`, not `add-members`."
    );
    expect(guideError.message).toContain(
      "openmeld space join <space-id> --profile agt_current --view agent"
    );
    expect(guideError.message).toContain(
      "add-members is only for additional profiles"
    );
  });

  it("builds remove-members argument guide for agent/non-interactive mode", () => {
    const guideError = createSpaceRemoveMembersGuideError();
    expect(guideError.message).toContain(
      "openmeld space remove-members in agent/non-interactive mode requires explicit space and member arguments."
    );
    expect(guideError.message).toContain("--password <value>");
    expect(guideError.message).toContain(
      "one selection mode: --member <profile-id...> | --all"
    );
    expect(guideError.message).toContain(
      "the current profile and the space creator are never removable through this command."
    );
    expect(guideError.message).toContain(
      "openmeld space remove-members --profile <profile-id> <space-id> --member <profile-id...> --view agent"
    );
  });

  it("builds current-profile remove-members guide that blocks self-removal", () => {
    const guideError = createSpaceRemoveMembersCurrentProfileGuideError({
      profileId: "agt_current",
    });
    expect(guideError.message).toContain(
      "Current profile cannot remove itself from a space with `remove-members`."
    );
    expect(guideError.message).toContain(
      "openmeld space leave <space-id> --profile agt_current --view agent"
    );
    expect(guideError.message).toContain(
      "self-removal is blocked for remove-members; leave is the self-exit command."
    );
    expect(guideError.message).not.toContain(
      "openmeld space remove-members <space-id> --profile agt_current --member"
    );
  });

  it("builds creator remove-members guide that redirects operators to delete or remove someone else", () => {
    const guideError = createSpaceRemoveMembersCreatorGuideError({
      profileId: "hum_creator",
    });
    expect(guideError.message).toContain(
      "The space creator cannot be removed from this space."
    );
    expect(guideError.message).toContain(
      "blocked creator profile: hum_creator"
    );
    expect(guideError.message).toContain("openmeld space delete <space-id>");
  });

  it("keeps send input recovery commands explicit in agent guides", () => {
    const conflictGuideError = createSpaceSendInputConflictGuideError();
    expect(conflictGuideError.message).toContain(
      'openmeld space send --profile <profile-id> <space-id> "hello"'
    );
    expect(conflictGuideError.message).toContain(
      "openmeld space send --profile <profile-id> <space-id> --stdin"
    );

    const fileReadGuideError = createSpaceSendInputFileReadFailedGuideError(
      "/tmp/message.txt",
      "ENOENT"
    );
    expect(fileReadGuideError.message).toContain(
      "openmeld space send --profile <profile-id> <space-id> --text-file <path>"
    );

    const emptyGuideError = createSpaceSendInputEmptyGuideError();
    expect(emptyGuideError.message).toContain(
      "echo 'hello' | openmeld space send --profile <profile-id> <space-id> --stdin"
    );
  });

  it("builds profile update argument guide", () => {
    const guideError = createProfileActionGuideError(
      "update",
      "explicit profile argument is required in agent view."
    );
    expect(guideError.message).toContain(
      "openmeld profiles update: explicit profile argument is required in agent view."
    );
    expect(guideError.message).toContain(
      "openmeld profiles update <profile-id>"
    );
    expect(guideError.message).toContain("[FOR HUMAN OPERATORS]");
    expect(guideError.message).toContain("[FOR AGENTS]");
  });

  it("renders openmeld-dev guide summaries and commands when the dev shortcut is active", () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");

    const guideError = createStartAuthenticationGuideError();

    expect(guideError.message).toContain(
      "openmeld-dev start requires sign-in before OpenMeld profile selection."
    );
    expect(guideError.message).toContain("openmeld-dev view human");
    expect(guideError.message).toContain(
      "openmeld-dev login --view agent --method ott --ott <token>"
    );
  });

  it("renders npx guide commands when npm exec metadata is active", () => {
    vi.stubEnv("npm_command", "exec");
    vi.stubEnv("npm_lifecycle_script", '"openmeld"');
    vi.stubEnv(
      "npm_config_user_agent",
      "npm/11.6.2 node/v25.1.0 darwin arm64 workspaces/false"
    );

    const guideError = createAuthLoginGuideError(
      "invalid --method value: use device|ott"
    );

    expect(guideError.message).toContain(
      "npx -y openmeld@latest auth login: invalid --method value: use device|ott"
    );
    expect(guideError.message).toContain(
      "npx -y openmeld@latest login --ott <token> --view agent"
    );
    expect(guideError.message).toContain(
      "npx -y openmeld@latest login --method device --no-open --view agent"
    );
  });
});
