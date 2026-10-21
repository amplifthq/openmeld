import { env as runtimeEnv } from "cloudflare:test";
import type { PostgreSQLBinding } from "@openmeld/db/postgresql";
import type { OrganizationFileRoot } from "../src/files/organization-file-root";
import type { LarkChannelConnector } from "../src/remote-agent/transport/lark/lark-channel-connector";

/**
 * Bindings that Core Worker tests read from the Workers test runtime. They come
 * from `wrangler.test.jsonc` plus the Miniflare options in the Vitest configs,
 * so they intentionally differ from the generated production `Cloudflare.Env`.
 */
export type WorkerTestEnv = {
  OPENMELD_POSTGRESQL: PostgreSQLBinding;
  TEST_POSTGRESQL_TEMPLATE: string;
  TEST_POSTGRESQL_PRE_GUARD_TEMPLATE?: string;
  TEST_POSTGRESQL_OWNER_GUARDS_AND_LATER?: string[];
  TEST_POSTGRESQL_OWNER: PostgreSQLBinding;
  OPENMELD_LARK_CHANNEL_CONNECTOR: DurableObjectNamespace<LarkChannelConnector>;
  OPENMELD_SPACE_ATTACHMENTS: R2Bucket;
  OPENMELD_ORGANIZATION_SKILLS: R2Bucket;
  OPENMELD_CLI_RELEASES: R2Bucket;
  OPENMELD_SPACES: unknown;
  OPENMELD_FILE_ROOTS: DurableObjectNamespace<OrganizationFileRoot>;
  OPENMELD_RUNTIME_TRANSPORT?: unknown;
  OPENMELD_PREPARE_SESSION_HUB?: unknown;
};

export const env = runtimeEnv as unknown as WorkerTestEnv;
