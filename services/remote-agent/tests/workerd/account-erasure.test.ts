import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { acknowledgeAccountErasure } from "../../flue-adapter/account-deletion";
import { personalComputerProviderName } from "../../flue-adapter/computer-identity";
import type { AgentComputer } from "../../flue-adapter/computer-workspace";
import type { AccountErasureProbe } from "./worker";
import { env } from "./worker-env";

it("erases the real personal Computer and rejects a delayed write through its old stub", async () => {
  const namespace = (
    env as { AGENT_COMPUTER: DurableObjectNamespace<AgentComputer> }
  ).AGENT_COMPUTER;
  const id = namespace.idFromName(
    personalComputerProviderName(crypto.randomUUID())
  );
  const original = namespace.get(id);
  await original.writeComputerFile(
    "/computer/home/private.txt",
    "Private account data"
  );
  await runInDurableObject(original, async (computer) => {
    expect(
      await computer.workspace.fs.readFile("/computer/home/private.txt", "utf8")
    ).toBe("Private account data");
  });
  await acknowledgeAccountErasure(
    async () => await namespace.get(id).eraseAccountComputer()
  );
  await expect(
    (async () =>
      await original.writeComputerFile("/computer/home/late.txt", "late"))()
  ).rejects.toThrow("Account content erased; old capabilities revoked.");
  await expect(
    (async () =>
      await namespace
        .get(id)
        .writeComputerFile("/computer/home/late.txt", "late"))()
  ).rejects.toThrow("permanently deleted");
  await runInDurableObject(namespace.get(id), async (computer) => {
    await computer.workspace.ready();
    for (const file of ["private.txt", "late.txt"]) {
      await expect(
        computer.workspace.fs.readFile(`/computer/home/${file}`, "utf8")
      ).rejects.toThrow(`no such file: /computer/home/${file}`);
    }
  });
});

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
