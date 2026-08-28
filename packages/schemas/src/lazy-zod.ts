import * as zod from "zod/v4";

export const NEVER = zod.NEVER;
export const ZodIssueCode = zod.ZodIssueCode;

const TERMINAL_METHODS = new Set<PropertyKey>([
  "apply",
  "decode",
  "decodeAsync",
  "encode",
  "encodeAsync",
  "implement",
  "implementAsync",
  "isNullable",
  "isOptional",
  "meta",
  "parse",
  "parseAsync",
  "register",
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
  "description",
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

export function lazySchema<TSchema extends zod.ZodType>(
  createSchema: () => TSchema
): TSchema {
  let schema: TSchema | undefined;
  const resolveSchema = (): TSchema => {
    schema ??= createSchema();
    return schema;
  };
  const readResolvedProperty = (property: PropertyKey): unknown => {
    const resolved = resolveSchema();
    const value = Reflect.get(resolved, property, resolved);
    return typeof value === "function" ? value.bind(resolved) : value;
  };

  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (
        typeof property === "symbol" ||
        EAGER_PROPERTIES.has(property) ||
        TERMINAL_METHODS.has(property)
      ) {
        return readResolvedProperty(property);
      }

      return (...args: unknown[]) =>
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
