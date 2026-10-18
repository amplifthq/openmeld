declare module "cloudflare:test" {
  type ProvidedEnv = {
    OPENMELD_POSTGRESQL: import("@openmeld/db/postgresql").PostgreSQLBinding;
    TEST_POSTGRESQL_TEMPLATE: string;
    TEST_POSTGRESQL_PRE_GUARD_TEMPLATE?: string;
    TEST_POSTGRESQL_OWNER_GUARDS_AND_LATER?: string[];
    TEST_POSTGRESQL_OWNER: import("@openmeld/db/postgresql").PostgreSQLBinding;
    OPENMELD_LARK_CHANNEL_CONNECTOR: DurableObjectNamespace<
      import("../src/remote-agent/transport/lark/lark-channel-connector").LarkChannelConnector
    >;
    OPENMELD_SPACE_ATTACHMENTS: R2Bucket;
    OPENMELD_ORGANIZATION_SKILLS: R2Bucket;
    OPENMELD_CLI_RELEASES: R2Bucket;
    OPENMELD_SPACES: unknown;
    OPENMELD_FILE_ROOTS: DurableObjectNamespace<
      import("../src/files/organization-file-root").OrganizationFileRoot
    >;
    OPENMELD_RUNTIME_TRANSPORT?: unknown;
    OPENMELD_PREPARE_SESSION_HUB?: unknown;
  };
}

declare module "*.sql?raw" {
  const content: string;
  export default content;
}
