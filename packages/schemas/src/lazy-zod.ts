import * as zod from "zod/v4";

export const NEVER = zod.NEVER;
export const ZodIssueCode = zod.ZodIssueCode;

const TERMINAL_METHODS = new Set<PropertyKey>([
  "decode",
  "decodeAsync",
  "encode",
  "encodeAsync",
  "implement",
  "implementAsync",
  "isNullable",
  "isOptional",
  "parse",
  "parseAsync",
  "safeDecode",
  "safeDecodeAsync",
  "safeEncode",
  "safeEncodeAsync",
  "safeParse",
  "safeParseAsync",
  "spa",
  "toJSONSchema",
]);

const EAGER_PROPERTIES = new Set<PropertyKey>([
  "_def",
  "_input",
  "_output",
  "_zod",
  "def",
  "element",
  "entries",
  "enum",
  "format",
  "in",
  "isFinite",
  "isInt",
  "keyType",
  "maxDate",
  "maxLength",
  "maxValue",
  "minDate",
  "minLength",
  "minValue",
  "options",
  "out",
  "shape",
  "then",
  "type",
  "value",
  "valueType",
  "values",
  "~standard",
]);

const SELF_RETURNING_METHODS = new Set<PropertyKey>(["brand", "finite"]);

type ZodRegistryLike = {
  add(schema: zod.ZodType, ...metadata: unknown[]): unknown;
  get(schema: zod.ZodType): unknown;
};

const globalRegistry = zod.globalRegistry as ZodRegistryLike;

export function lazySchema<TSchema extends zod.ZodType>(
  createSchema: () => TSchema
): TSchema {
  let schema: TSchema | undefined;
  let proxy: TSchema;
  const registrations: Array<{
    metadata: unknown[];
    registry: ZodRegistryLike;
  }> = [];
  const resolveSchema = (): TSchema => {
    if (!schema) {
      schema = createSchema();
      for (const registration of registrations) {
        registration.registry.add(schema, ...registration.metadata);
        registration.registry.add(proxy, ...registration.metadata);
      }
    }
    return schema;
  };
  const readResolvedProperty = (property: PropertyKey): unknown => {
    const resolved = resolveSchema();
    const value = Reflect.get(resolved, property, resolved);
    return typeof value === "function" ? value.bind(resolved) : value;
  };
  const deferSchemaMethod = (
    property: PropertyKey,
    args: unknown[]
  ): zod.ZodType =>
    lazySchema(() => {
      const resolved = resolveSchema();
      const method = Reflect.get(resolved, property, resolved);
      if (typeof method !== "function") {
        throw new TypeError(
          `Lazy Zod property ${String(property)} is not callable`
        );
      }
      const result = Reflect.apply(method, resolved, args);
      if (!(result instanceof zod.ZodType)) {
        throw new TypeError(
          `Lazy Zod method ${String(property)} did not return a schema`
        );
      }
      return result;
    });

  proxy = new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (property === "description") {
        const metadata = globalRegistry.get(proxy);
        return metadata && typeof metadata === "object"
          ? Reflect.get(metadata, "description")
          : undefined;
      }
      if (property === "apply") {
        return (operation: (schema: TSchema) => unknown) => operation(proxy);
      }
      if (property === "register") {
        return (registry: ZodRegistryLike, ...metadata: unknown[]) => {
          registrations.push({ metadata, registry });
          if (schema) {
            registry.add(schema, ...metadata);
          }
          registry.add(proxy, ...metadata);
          return proxy;
        };
      }
      if (property === "meta") {
        return (...metadata: unknown[]) => {
          if (metadata.length === 0) {
            return globalRegistry.get(proxy);
          }
          const registered = deferSchemaMethod(property, metadata);
          globalRegistry.add(registered, ...metadata);
          return registered;
        };
      }
      if (property === "describe") {
        return (description: string) => {
          const described = deferSchemaMethod(property, [description]);
          globalRegistry.add(described, { description });
          return described;
        };
      }
      if (SELF_RETURNING_METHODS.has(property)) {
        return () => proxy;
      }
      if (
        typeof property === "symbol" ||
        EAGER_PROPERTIES.has(property) ||
        TERMINAL_METHODS.has(property)
      ) {
        return readResolvedProperty(property);
      }

      return (...args: unknown[]) => deferSchemaMethod(property, args);
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(
        resolveSchema(),
        property
      );
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(resolveSchema());
    },
    has(_target, property) {
      return Reflect.has(resolveSchema(), property);
    },
    ownKeys() {
      return Reflect.ownKeys(resolveSchema());
    },
    set(_target, property, value) {
      return Reflect.set(resolveSchema(), property, value);
    },
  }) as TSchema;
  return proxy;
}

function lazyFactory<TFactory extends (...args: never[]) => zod.ZodType>(
  factory: TFactory
): TFactory {
  const invoke = factory as unknown as (...args: unknown[]) => zod.ZodType;
  return ((...args: unknown[]) =>
    lazySchema(() => invoke(...args))) as unknown as TFactory;
}

export const array = lazyFactory(zod.array);
export const boolean = lazyFactory(zod.boolean);
export const discriminatedUnion = lazyFactory(zod.discriminatedUnion);
export const email = lazyFactory(zod.email);
const enumFactory = lazyFactory(zod.enum);
export { enumFactory as enum };
export const int = lazyFactory(zod.int);
export const literal = lazyFactory(zod.literal);
const neverFactory = lazyFactory(zod.never);
export { neverFactory as never };
const nullFactory = lazyFactory(zod.null);
export { nullFactory as null };
export const number = lazyFactory(zod.number);
export const object = lazyFactory(zod.object);
export const preprocess = lazyFactory(zod.preprocess);
export const record = lazyFactory(zod.record);
export const strictObject = lazyFactory(zod.strictObject);
export const string = lazyFactory(zod.string);
export const tuple = lazyFactory(zod.tuple);
export const union = lazyFactory(zod.union);
const undefinedFactory = lazyFactory(zod.undefined);
export { undefinedFactory as undefined };
export const unknown = lazyFactory(zod.unknown);
export const url = lazyFactory(zod.url);

export const coerce: typeof zod.coerce = {
  ...zod.coerce,
  bigint: lazyFactory(zod.coerce.bigint),
  boolean: lazyFactory(zod.coerce.boolean),
  date: lazyFactory(zod.coerce.date),
  number: lazyFactory(zod.coerce.number),
  string: lazyFactory(zod.coerce.string),
};

export const iso: typeof zod.iso = {
  ...zod.iso,
  date: lazyFactory(zod.iso.date),
  datetime: lazyFactory(zod.iso.datetime),
  duration: lazyFactory(zod.iso.duration),
  time: lazyFactory(zod.iso.time),
};
