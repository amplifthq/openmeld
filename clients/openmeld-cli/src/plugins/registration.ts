import { pluginActionRequestSchema } from "@openmeld/schemas";
import { type Command, Option } from "commander";
import { runPluginCommand } from "./command";

export function registerPluginCommands(
  program: Command,
  options: {
    view: () => string | undefined;
    run: (tokens: string[], execute: () => Promise<void>) => Promise<void>;
  }
) {
  const plugins = program
    .command("plugins")
    .description("Use connected accounts with your Local Agent’s permissions.");
  const common = (command: Command) =>
    command.option(
      "--profile <agent-profile-id>",
      "Local Agent acting for your account."
    );
  common(
    plugins
      .command("list")
      .description("List accounts available to this Local Agent.")
  ).action(async (flags: { profile?: string }) => {
    await options.run(["plugins", "list"], () =>
      runPluginCommand({
        action: { operation: "list" },
        profile: flags.profile,
        view: options.view(),
      })
    );
  });
  common(
    plugins
      .command("connect <service>")
      .description(
        "Offer a secure Plugin connection link; the requester authorizes in OpenMeld."
      )
  )
    .addOption(
      new Option(
        "--account <scope>",
        "Preserve an explicit personal/shared identity; choose asks only when necessary."
      )
        .choices(["personal", "shared", "choose"])
        .default("choose")
    )
    .action(
      async (service: string, flags: { profile?: string; account: string }) => {
        const request = pluginActionRequestSchema.parse({
          action: { operation: "connect", service, account: flags.account },
        });
        await options.run(["plugins", "connect"], () =>
          runPluginCommand({
            action: request.action,
            profile: flags.profile,
            view: options.view(),
          })
        );
      }
    );
  common(
    plugins
      .command("actions <service>")
      .description("List permitted actions and their input schemas.")
  )
    .addOption(
      new Option("--account <scope>", "Account identity to use.")
        .choices(["personal", "shared"])
        .makeOptionMandatory()
    )
    .action(
      async (service: string, flags: { profile?: string; account: string }) => {
        const request = pluginActionRequestSchema.parse({
          action: { operation: "actions", service, account: flags.account },
        });
        await options.run(["plugins", "actions"], () =>
          runPluginCommand({
            action: request.action,
            profile: flags.profile,
            view: options.view(),
          })
        );
      }
    );
  common(
    plugins
      .command("call <service> <action-id>")
      .description(
        "Run an action; reuse the operation ID only for the exact same request."
      )
  )
    .addOption(
      new Option("--account <scope>", "Account identity to use.")
        .choices(["personal", "shared"])
        .makeOptionMandatory()
    )
    .requiredOption(
      "--operation <id>",
      "Unique operation ID for this exact action."
    )
    .option("--input <json>", "Action input as a JSON object.", "{}")
    .option("--confirm <token>", "Confirmation returned for this exact action.")
    .option(
      "--verify-operation <id>",
      "Link this read to an original operation without changing its outcome."
    )
    .option(
      "--verify-action <id>",
      "Original action ID for --verify-operation."
    )
    .option(
      "--replay",
      "Use the original operation's explicitly permitted, single replay."
    )
    .action(
      async (
        service: string,
        actionId: string,
        flags: {
          profile?: string;
          account: string;
          operation: string;
          input: string;
          confirm?: string;
          replay?: boolean;
          verifyOperation?: string;
          verifyAction?: string;
        }
      ) => {
        const request = pluginActionRequestSchema.parse({
          action: {
            operation: "execute",
            service,
            actionId,
            account: flags.account,
            operationId: flags.operation,
            input: JSON.parse(flags.input),
            confirmationToken: flags.confirm,
            replay: flags.replay,
            ...(flags.verifyOperation || flags.verifyAction
              ? {
                  verificationOf: {
                    operationId: flags.verifyOperation,
                    actionId: flags.verifyAction,
                  },
                }
              : {}),
          },
        });
        await options.run(["plugins", "call"], () =>
          runPluginCommand({
            action: request.action,
            profile: flags.profile,
            view: options.view(),
          })
        );
      }
    );
}
