import * as zod from "zod/v4";

export const NEVER = zod.NEVER;
export const ZodIssueCode = zod.ZodIssueCode;

const DEFERRED_SCHEMA_METHODS = new Set<PropertyKey>([
  "and",
  "array",
  "base64",
  "base64url",
  "catch",
  "catchall",
  "check",
  "cidrv4",
  "cidrv6",
  "clone",
  "cuid",
  "cuid2",
  "date",
  "datetime",
  "default",
  "duration",
  "e164",
  "email",
  "emoji",
  "endsWith",
  "exactOptional",
  "exclude",
  "extend",
  "extract",
  "gt",
  "gte",
  "guid",
  "includes",
  "input",
  "int",
  "ipv4",
  "ipv6",
  "jwt",
  "keyof",
  "ksuid",
  "length",
  "loose",
  "lowercase",
  "lt",
  "lte",
  "max",
  "merge",
  "mime",
  "min",
  "multipleOf",
  "nanoid",
  "negative",
  "nonempty",
  "nonnegative",
  "nonoptional",
  "nonpositive",
  "normalize",
  "nullable",
  "nullish",
  "omit",
  "optional",
  "or",
  "output",
  "overwrite",
  "partial",
  "passthrough",
  "pick",
  "pipe",
  "positive",
  "prefault",
  "readonly",
  "refine",
  "regex",
  "removeCatch",
  "removeDefault",
  "required",
  "rest",
  "safe",
  "safeExtend",
  "size",
  "slugify",
  "startsWith",
  "step",
  "strict",
  "strip",
  "superRefine",
  "time",
  "toLowerCase",
  "toUpperCase",
  "transform",
  "trim",
  "ulid",
  "unwrap",
  "uppercase",
  "url",
  "uuid",
  "uuidv4",
  "uuidv6",
  "uuidv7",
  "with",
  "xid",
]);

const SELF_RETURNING_METHODS = new Set<PropertyKey>(["brand", "finite"]);
const UNHANDLED_PROPERTY = Symbol("unhandled lazy Zod property");

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
  const target = Object.create(null) as object;
  let targetIsMaterialized = false;
  const resolveSchema = (): TSchema => {
    schema ??= createSchema();
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
  const materializeTarget = (): TSchema => {
    const resolved = resolveSchema();
    if (targetIsMaterialized) {
      return resolved;
    }
    Reflect.setPrototypeOf(target, Reflect.getPrototypeOf(resolved));
    for (const property of Reflect.ownKeys(resolved)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolved, property);
      if (descriptor) {
        Reflect.defineProperty(target, property, descriptor);
      }
    }
    targetIsMaterialized = true;
    return resolved;
  };
  const readSpecialProperty = (property: PropertyKey): unknown => {
    switch (property) {
      case "description": {
        const metadata = globalRegistry.get(proxy);
        return metadata && typeof metadata === "object"
          ? Reflect.get(metadata, "description")
          : undefined;
      }
      case "apply":
        return (operation: (schema: TSchema) => unknown) => operation(proxy);
      case "register":
        return (registry: ZodRegistryLike, ...metadata: unknown[]) => {
          registry.add(proxy, ...metadata);
          return proxy;
        };
      case "meta":
        return (...metadata: unknown[]) => {
          if (metadata.length === 0) {
            return globalRegistry.get(proxy);
          }
          const registered = deferSchemaMethod(property, metadata);
          globalRegistry.add(registered, ...metadata);
          return registered;
        };
      case "describe":
        return (description: string) => {
          const described = deferSchemaMethod(property, [description]);
          globalRegistry.add(described, { description });
          return described;
        };
      case "toJSONSchema":
        return (...args: unknown[]) =>
          Reflect.apply(zod.toJSONSchema, zod, [proxy, ...args]);
      default:
        return UNHANDLED_PROPERTY;
    }
  };

  proxy = new Proxy(target, {
    deleteProperty(_target, property) {
      const deletedFromTarget = Reflect.deleteProperty(target, property);
      const deletedFromSchema = Reflect.deleteProperty(
        resolveSchema(),
        property
      );
      return deletedFromTarget && deletedFromSchema;
    },
    get(_target, property, receiver) {
      const specialProperty = readSpecialProperty(property);
      if (specialProperty !== UNHANDLED_PROPERTY) {
        return specialProperty;
      }
      if (SELF_RETURNING_METHODS.has(property)) {
        return () => proxy;
      }
      if (DEFERRED_SCHEMA_METHODS.has(property)) {
        return (...args: unknown[]) => deferSchemaMethod(property, args);
      }

      const targetDescriptor = Reflect.getOwnPropertyDescriptor(
        target,
        property
      );
      return targetDescriptor
        ? Reflect.get(target, property, receiver)
        : readResolvedProperty(property);
    },
    getOwnPropertyDescriptor(_target, property) {
      const targetDescriptor = Reflect.getOwnPropertyDescriptor(
        target,
        property
      );
      if (targetDescriptor || targetIsMaterialized) {
        return targetDescriptor;
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(
        resolveSchema(),
        property
      );
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf() {
      return targetIsMaterialized
        ? Reflect.getPrototypeOf(target)
        : Reflect.getPrototypeOf(resolveSchema());
    },
    has(_target, property) {
      return (
        Reflect.has(target, property) || Reflect.has(resolveSchema(), property)
      );
    },
    ownKeys() {
      if (targetIsMaterialized) {
        return Reflect.ownKeys(target);
      }
      return [
        ...new Set([
          ...Reflect.ownKeys(target),
          ...Reflect.ownKeys(resolveSchema()),
        ]),
      ];
    },
    preventExtensions() {
      const resolved = materializeTarget();
      return (
        Reflect.preventExtensions(resolved) && Reflect.preventExtensions(target)
      );
    },
    set(_target, property, value) {
      const resolved = resolveSchema();
      if (!targetIsMaterialized) {
        return Reflect.set(resolved, property, value);
      }
      return (
        Reflect.set(resolved, property, value) &&
        Reflect.set(target, property, value)
      );
    },
  }) as TSchema;
  return proxy;
}

function snapshotFactoryArgument(value: unknown): unknown {
  return Array.isArray(value) ? [...value] : value;
}

function lazyFactory<TFactory extends (...args: never[]) => zod.ZodType>(
  factory: TFactory
): TFactory {
  const invoke = factory as unknown as (...args: unknown[]) => zod.ZodType;
  return ((...args: unknown[]) => {
    const declaredArgs = args.map(snapshotFactoryArgument);
    return lazySchema(() => invoke(...declaredArgs));
  }) as unknown as TFactory;
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
