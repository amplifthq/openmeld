import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { acknowledgeAccountErasure } from "../../flue-adapter/account-deletion";
import type { AccountErasureProbe } from "./worker";

it("erases persisted content, revokes old capabilities, and prevents a late write after restart", async () => {
  const namespace = (
    env as {
      ACCOUNT_ERASURE_PROBE: DurableObjectNamespace<AccountErasureProbe>;
    }
  ).ACCOUNT_ERASURE_PROBE;
  const id = namespace.newUniqueId();
  const first = namespace.get(id);
  using held = await first.seed();
  expect(await held.read()).toBe("private cached content");
  await acknowledgeAccountErasure(async () => await namespace.get(id).erase());
  await expect((async () => await held.read())()).rejects.toThrow();
  const retry = namespace.get(id);
  await retry.erase();
  expect(await retry.inspect()).toEqual({ erased: true, content: null });
  await expect((async () => await retry.seed())()).rejects.toThrow(
    "permanently deleted"
  );
});
