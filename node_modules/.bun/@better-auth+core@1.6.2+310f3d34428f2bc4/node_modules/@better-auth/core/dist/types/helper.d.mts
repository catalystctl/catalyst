//#region src/types/helper.d.ts
type Primitive = string | number | symbol | bigint | boolean | null | undefined;
type Awaitable<T> = T | Promise<T>;
type AwaitableFunction<T> = T | (() => Awaitable<T>);
type LiteralString = "" | (string & Record<never, never>);
type LiteralUnion<LiteralType, BaseType extends Primitive> = LiteralType | (BaseType & Record<never, never>);
type Prettify<T> = { [K in keyof T]: T[K] } & {};
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;
//#endregion
export { Awaitable, AwaitableFunction, LiteralString, LiteralUnion, Prettify, Primitive, UnionToIntersection };