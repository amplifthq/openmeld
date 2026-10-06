export function initializePostgresTests(options?: {
  legacyBindingFixtures?: boolean;
}): Promise<{
  runtime: string;
  owner: string;
  templateName: string;
  preGuardTemplateName?: string;
  ownerGuardsAndLater?: string[];
}>;
