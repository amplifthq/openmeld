/** The historical Better Auth generator emits D1 customizations, not the native model. */
export const runAuthCodegen = (): never => {
  throw new Error(
    "Historical Better Auth D1 schema generation is retired. Update the canonical PostgreSQL Auth schema and use db:generate for reviewed native migrations."
  );
};

export const emitAuthCodegen = (): never => runAuthCodegen();
