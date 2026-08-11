import {
  decryptAesGcmSecret,
  encryptAesGcmSecret,
} from "./aes-gcm-secret-crypto";

const SLACK_TOKEN_CRYPTO_KEY_NAME = "SLACK_OPENMELD_TOKEN_CRYPTO_KEY";

export async function encryptSlackBotToken(input: {
  botToken: string;
  cryptoKey: string;
}): Promise<string> {
  return await encryptSlackSecret({
    cryptoKey: input.cryptoKey,
    secret: input.botToken,
    secretName: "Slack bot token",
  });
}

export async function encryptSlackSecret(input: {
  cryptoKey: string;
  secret: string;
  secretName: string;
}): Promise<string> {
  return await encryptAesGcmSecret({
    cryptoKey: input.cryptoKey,
    cryptoKeyName: SLACK_TOKEN_CRYPTO_KEY_NAME,
    secret: input.secret,
    secretName: input.secretName,
  });
}

export async function decryptSlackBotToken(input: {
  encryptedBotToken: string;
  cryptoKey: string;
}): Promise<string> {
  return await decryptSlackSecret({
    cryptoKey: input.cryptoKey,
    encryptedSecret: input.encryptedBotToken,
    secretName: "Slack bot token",
  });
}

export async function decryptSlackSecret(input: {
  cryptoKey: string;
  encryptedSecret: string;
  secretName: string;
}): Promise<string> {
  return await decryptAesGcmSecret({
    cryptoKey: input.cryptoKey,
    cryptoKeyName: SLACK_TOKEN_CRYPTO_KEY_NAME,
    encryptedSecret: input.encryptedSecret,
    secretName: input.secretName,
  });
}
