import { PLUGINS } from "@openmeld/product-catalog/plugins";

export const websitePlugins = PLUGINS.filter(
	(plugin) => plugin.availability === "available"
);

// Public catalog size, not account-specific connection readiness.
export const websitePluginCountLabel = `${Math.floor(websitePlugins.length / 10) * 10}+`;
