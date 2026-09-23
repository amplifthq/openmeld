import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CLOUDFLARE_ACCOUNT_ID = /^[a-f0-9]{32}$/u;
const RELEASE_TOKEN_NAME = "CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN";
export const DEFAULT_R2_BUCKET_NAME = "openmeld-desktop-downloads-prod";

export function desktopPublisherCredentials(env = process.env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env[RELEASE_TOKEN_NAME]?.trim();
  if (!(CLOUDFLARE_ACCOUNT_ID.test(accountId ?? "") && token)) {
    throw new Error(
      `Desktop publication requires CLOUDFLARE_ACCOUNT_ID and ${RELEASE_TOKEN_NAME} from openmeld-release/prd. Check them before signing; local Wrangler OAuth is not a publishing identity.`
    );
  }
  return {
    accountId,
    bucket: DEFAULT_R2_BUCKET_NAME,
    env: { ...env, CLOUDFLARE_API_TOKEN: token },
  };
}

export async function checkDesktopPublisher(input = {}) {
  const credentials = desktopPublisherCredentials(input.env);
  const url = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/r2/buckets/${credentials.bucket}`;
  let response;
  try {
    response = await (input.fetchBucket ?? fetch)(url, {
      headers: {
        Authorization: `Bearer ${credentials.env.CLOUDFLARE_API_TOKEN}`,
      },
    });
  } catch (error) {
    throw new Error(
      `Desktop publisher check could not reach ${credentials.bucket} in account ${credentials.accountId}: ${error instanceof Error ? error.message : String(error)}. No Desktop object was written.`
    );
  }
  if (!response.ok) {
    throw new Error(
      `Desktop publisher check failed for ${credentials.bucket} in account ${credentials.accountId} (HTTP ${response.status}). Confirm the openmeld-release/prd credential before signing. No Desktop object was written.`
    );
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error(
      `Desktop publisher check returned invalid bucket metadata for account ${credentials.accountId}: ${error instanceof Error ? error.message : String(error)}. No Desktop object was written.`
    );
  }
  if (result?.success !== true || result.result?.name !== credentials.bucket) {
    throw new Error(
      `Desktop publisher check returned an unexpected bucket for account ${credentials.accountId}. No Desktop object was written.`
    );
  }
  (input.write ?? ((line) => process.stdout.write(line)))(
    `[release:desktop-preview] Publisher: openmeld-release/prd; account: ${credentials.accountId}; bucket: ${credentials.bucket}. Bucket read confirmed; upload permission is checked by the guarded publication.\n`
  );
  return credentials.env;
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    await checkDesktopPublisher();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
