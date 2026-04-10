/**
 * Global symbol used to identify ObjectEnumValue instances across bundle
 * boundaries. `Symbol.for()` returns the same symbol globally, so it works
 * even when multiple copies of this module are loaded (e.g., browser and
 * server bundles in Next.js, or HMR reloads).
 * See: https://github.com/prisma/prisma/issues/29257
 */
declare const PRISMA_OBJECT_ENUM_VALUE: unique symbol;
/**
 * Base class for unique values of object-valued enums.
 */
export declare abstract class ObjectEnumValue {
    #private;
    readonly [PRISMA_OBJECT_ENUM_VALUE] = true;
    constructor(arg?: symbol);
    abstract _getNamespace(): string;
    _getName(): string;
    toString(): string;
}
declare class NullTypesEnumValue extends ObjectEnumValue {
    _getNamespace(): string;
}
export declare class DbNullClass extends NullTypesEnumValue {
    #private;
}
export declare class JsonNullClass extends NullTypesEnumValue {
    #private;
}
export declare class AnyNullClass extends NullTypesEnumValue {
    #private;
}
export declare const NullTypes: {
    DbNull: typeof DbNullClass;
    JsonNull: typeof JsonNullClass;
    AnyNull: typeof AnyNullClass;
};
export declare const DbNull: DbNullClass;
export declare const JsonNull: JsonNullClass;
export declare const AnyNull: AnyNullClass;
/**
 * Check if a value is an ObjectEnumValue instance. Uses a global symbol
 * instead of instanceof to work across bundle boundaries (e.g., when a
 * Next.js app bundles browser and server code separately, creating duplicate
 * module instances of @prisma/client-runtime-utils).
 * See: https://github.com/prisma/prisma/issues/29257
 */
export declare function isObjectEnumValue(value: unknown): value is ObjectEnumValue;
/**
 * Check if a value is the DBNull singleton instance.
 */
export declare function isDbNull(value: unknown): value is DbNullClass;
/**
 * Check if a value is the JsonNull singleton instance.
 */
export declare function isJsonNull(value: unknown): value is JsonNullClass;
/**
 * Check if a value is the AnyNull singleton instance.
 */
export declare function isAnyNull(value: unknown): value is AnyNullClass;
export {};
