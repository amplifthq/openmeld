import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { readEmbeddedModelCatalog } from "../src/model-catalog/embedded";
import { createModelCatalogReadSession } from "../src/system/model-catalog-read-session";
import { withTempHome } from "./helpers/fs";

describe("model catalog delivery", () => {
  it("reads a newly published model without changing the offline catalog, and survives offline use", async () => {
    await withTempHome(async () => {
      const fallback = readEmbeddedModelCatalog();
      const online = structuredClone(fallback);
      const codex = online.agentControllers.codex;
      if (!codex?.models[0]) {
        throw new Error("The shipped Codex fallback is missing.");
      }
      const newModel = {
        ...codex.models[0],
        id: "new-online-model",
        displayName: "New online model",
      };
      codex.models.push(newModel);
      let available = true;
      const server = createServer((request, response) => {
        if (request.url !== "/v1/config/model-catalog") {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(available ? 200 : 503, {
          "Content-Type": "application/json",
        });
        response.end(JSON.stringify(available ? online : { error: "offline" }));
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Local catalog server did not bind.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      try {
        const catalog = await createModelCatalogReadSession({ baseUrl }).read();
        expect(catalog.agentControllers.codex?.models).toContainEqual(newModel);
        available = false;
        expect(await createModelCatalogReadSession({ baseUrl }).read()).toEqual(
          fallback
        );
        expect(
          readEmbeddedModelCatalog().agentControllers.codex?.models.some(
            (model) => model.id === newModel.id
          )
        ).toBe(false);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    });
  });
});
