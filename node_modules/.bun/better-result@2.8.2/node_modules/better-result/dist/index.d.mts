//#region src/error.d.ts
/** Any tagged error (for generic constraints) */
type AnyTaggedError = Error & {
  readonly _tag: string;
};
/**
 * Factory for tagged error classes.
 *
 * @example
 * class NotFoundError extends TaggedError("NotFoundError")<{
 *   id: string;
 *   message: string;
 * }>() {}
 *
 * const err = new NotFoundError({ id: "123", message: "Not found: 123" });
 * err._tag    // "NotFoundError"
 * err.id      // "123"
 * err.message // "Not found: 123"
 *
 * // Check if any tagged error
 * TaggedError.is(err) // true
 */
declare const TaggedError: {
  <Tag extends string>(tag: Tag): <Props extends Record<string, unknown> = {}>() => TaggedErrorClass<Tag, Props>;
  /** Type guard for any TaggedError instance */
  is(value: unknown): value is AnyTaggedError;
};
/** Instance type produced by TaggedError factory */
type TaggedErrorInstance<Tag extends string, Props> = Error & {
  readonly _tag: Tag;
  toJSON(): object;
} & Readonly<Props>;
/** Class type produced by TaggedError factory */
type TaggedErrorClass<Tag extends string, Props> = {
  new (...args: keyof Props extends never ? [args?: {}] : [args: Props]): TaggedErrorInstance<Tag, Props>;
  /** Type guard for this error class */
  is(value: unknown): value is TaggedErrorInstance<Tag, Props>;
};
/** Handler map for exhaustive matching */
type MatchHandlers<E extends AnyTaggedError, R> = { [K in E["_tag"]]: (err: Extract<E, {
  _tag: K;
}>) => R };
/** Partial handler map for non-exhaustive matching */
type PartialMatchHandlers<E extends AnyTaggedError, R> = Partial<MatchHandlers<E, R>>;
/** Extract handled tags from a handlers object */
type HandledTags<E extends AnyTaggedError, H> = Extract<keyof H, E["_tag"]>;
/**
 * Exhaustive pattern match on tagged error union.
 *
 * @example
 * // Data-first
 * matchError(err, {
 *   NotFoundError: (e) => `Missing: ${e.id}`,
 *   ValidationError: (e) => `Invalid: ${e.field}`,
 * });
 *
 * // Data-last (pipeable)
 * pipe(err, matchError({
 *   NotFoundError: (e) => `Missing: ${e.id}`,
 *   ValidationError: (e) => `Invalid: ${e.field}`,
 * }));
 */
declare const matchError: {
  <E extends AnyTaggedError, R>(err: E, handlers: MatchHandlers<E, R>): R;
  <E extends AnyTaggedError, R>(handlers: MatchHandlers<E, R>): (err: E) => R;
};
/**
 * Partial pattern match with fallback for unhandled tags.
 *
 * @example
 * matchErrorPartial(err, {
 *   NotFoundError: (e) => `Missing: ${e.id}`,
 * }, (e) => `Unknown: ${e.message}`);
 */
declare const matchErrorPartial: {
  <E extends AnyTaggedError, R, const H extends PartialMatchHandlers<E, R>>(err: E, handlers: H, fallback: (e: Exclude<E, {
    _tag: NoInfer<HandledTags<E, H>>;
  }>) => R): R;
  <E extends AnyTaggedError, R, const H extends PartialMatchHandlers<E, R> = PartialMatchHandlers<E, R>>(handlers: H, fallback: (e: Exclude<E, {
    _tag: NoInfer<HandledTags<E, H>>;
  }>) => R): (err: E) => R;
};
/**
 * Type guard for tagged error instances.
 *
 * @example
 * if (isTaggedError(value)) { value._tag }
 */
declare const isTaggedError: (value: unknown) => value is AnyTaggedError;
declare const UnhandledException_base: TaggedErrorClass<"UnhandledException", {
  message: string;
  cause: unknown;
}>;
/**
 * Wraps exceptions caught by Result.try/tryPromise.
 * Custom constructor derives message from cause.
 */
declare class UnhandledException extends UnhandledException_base {
  constructor(args: {
    cause: unknown;
  });
}
declare const Panic_base: TaggedErrorClass<"Panic", {
  message: string;
  cause?: unknown;
}>;
/**
 * Unrecoverable error — user code threw inside Result operations.
 *
 * @example
 * // Panic in generator cleanup:
 * Result.gen(function* () {
 *   try {
 *     yield* Result.err("expected error");
 *   } finally {
 *     throw new Error("cleanup failed");  // Panic!
 *   }
 * });
 *
 * // Panic in combinator:
 * Result.ok(1).map(() => { throw new Error("oops"); });  // Panic!
 */
declare class Panic extends Panic_base {}
declare const ResultDeserializationError_base: TaggedErrorClass<"ResultDeserializationError", {
  message: string;
  value: unknown;
}>;
/**
 * Returned when Result.deserialize receives invalid input.
 *
 * @example
 * const result = Result.deserialize(invalidData);
 * if (Result.isError(result) && ResultDeserializationError.is(result.error)) {
 *   console.log("Invalid input:", result.error.value);
 * }
 */
declare class ResultDeserializationError extends ResultDeserializationError_base {
  constructor(args: {
    value: unknown;
  });
}
/**
 * Type guard for Panic instances.
 *
 * @example
 * if (isPanic(value)) { value.cause }
 */
declare const isPanic: (value: unknown) => value is Panic;
/**
 * Throw an unrecoverable Panic.
 *
 * @example
 * panic("something went wrong", cause);
 */
declare const panic: (message: string, cause?: unknown) => never;
//#endregion
//#region src/result.d.ts
type TapBothHandlers<A, E> = {
  ok: (a: A) => void;
  err: (e: E) => void;
};
type TapBothOkHandlers<A> = {
  ok: (a: A) => void;
  err: (e: never) => void;
};
type TapBothErrHandlers<E> = {
  ok: (a: never) => void;
  err: (e: E) => void;
};
type TapBothAsyncHandlers<A, E> = {
  ok: (a: A) => Promise<void>;
  err: (e: E) => Promise<void>;
};
type TapBothAsyncOkHandlers<A> = {
  ok: (a: A) => Promise<void>;
  err: (e: never) => Promise<void>;
};
type TapBothAsyncErrHandlers<E> = {
  ok: (a: never) => Promise<void>;
  err: (e: E) => Promise<void>;
};
/**
 * Successful result variant.
 *
 * @template A Success value type.
 * @template E Error type (phantom - for type unification).
 *
 * @example
 * const result = new Ok(42);
 * result.value // 42
 * result.status // "ok"
 */
declare class Ok<A, E = never> {
  readonly value: A;
  readonly status: "ok";
  constructor(value: A);
  /** Returns true, narrowing Result to Ok. */
  isOk(): this is Ok<A, E>;
  /** Returns false, narrowing Result to Err. */
  isErr(): this is Err<A, E>;
  /**
   * Transforms success value.
   *
   * @template B Transformed type.
   * @param fn Transformation function.
   * @returns Ok with transformed value.
   * @throws {Panic} If fn throws.
   *
   * @example
   * ok(2).map(x => x * 2) // Ok(4)
   */
  map<B>(fn: (a: A) => B): Ok<B, E>;
  /**
   * No-op on Ok, returns self with new phantom error type.
   *
   * @template E2 New error type.
   * @param _fn Ignored.
   * @returns Self with updated phantom E type.
   */
  mapError<E2>(_fn: (e: never) => E2): Ok<A, E2>;
  /**
   * No-op on Ok, returns self with new phantom error type.
   *
   * @template E2 New error type.
   * @param _fn Ignored.
   * @returns Self with updated phantom E type.
   *
   * @example
   * ok(42).tryRecover(e => ok(e.length)) // Ok(42)
   */
  tryRecover<E2>(_fn: (e: never) => Result<A, E2>): Ok<A, E2>;
  /**
   * No-op on Ok, returns Promise of self with new phantom error type.
   *
   * @template E2 New error type.
   * @param _fn Ignored.
   * @returns Promise of self with updated phantom E type.
   *
   * @example
   * await ok(42).tryRecoverAsync(async e => ok(e.length)) // Ok(42)
   */
  tryRecoverAsync<E2>(_fn: (e: never) => Promise<Result<A, E2>>): Promise<Ok<A, E2>>;
  /**
   * Chains Result-returning function.
   *
   * @template B New success type.
   * @template E2 New error type.
   * @param fn Function returning Result.
   * @returns Result from fn.
   * @throws {Panic} If fn throws.
   *
   * @example
   * ok(2).andThen(x => x > 0 ? ok(x) : err("negative")) // Ok(2)
   */
  andThen<B, E2>(fn: (a: A) => Result<B, E2>): Result<B, E | E2>;
  /**
   * Chains async Result-returning function.
   *
   * @template B New success type.
   * @template E2 New error type.
   * @param fn Async function returning Result.
   * @returns Promise of Result from fn.
   * @throws {Panic} If fn throws synchronously or rejects.
   *
   * @example
   * await ok(1).andThenAsync(async x => ok(await fetchData(x)))
   */
  andThenAsync<B, E2>(fn: (a: A) => Promise<Result<B, E2>>): Promise<Result<B, E | E2>>;
  /**
   * Pattern matches on Result.
   *
   * @template T Return type.
   * @param handlers Ok and err handlers.
   * @returns Result of ok handler.
   * @throws {Panic} If handler throws.
   *
   * @example
   * ok(2).match({ ok: x => x * 2, err: () => 0 }) // 4
   */
  match<T>(handlers: {
    ok: (a: A) => T;
    err: (e: never) => T;
  }): T;
  /**
   * Extracts value.
   *
   * @param _message Ignored.
   * @returns The value.
   *
   * @example
   * ok(42).unwrap() // 42
   */
  unwrap(_message?: string): A;
  /**
   * Returns value, ignoring fallback.
   *
   * @template B Fallback type.
   * @param _fallback Ignored.
   * @returns The value.
   *
   * @example
   * ok(42).unwrapOr(0) // 42
   */
  unwrapOr<B>(_fallback: B): A;
  /**
   * Runs side effect, returns self.
   *
   * @param fn Side effect function.
   * @returns Self.
   * @throws {Panic} If fn throws.
   *
   * @example
   * ok(2).tap(console.log).map(x => x * 2) // logs 2, returns Ok(4)
   */
  tap(fn: (a: A) => void): Ok<A, E>;
  /**
   * Runs async side effect, returns self.
   *
   * @param fn Async side effect function.
   * @returns Promise of self.
   * @throws {Panic} If fn throws synchronously or rejects.
   *
   * @example
   * await ok(2).tapAsync(async x => await log(x))
   */
  tapAsync(fn: (a: A) => Promise<void>): Promise<Ok<A, E>>;
  /**
   * No-op on Ok, returns self.
   *
   * @param _fn Ignored.
   * @returns Self.
   */
  tapError(_fn: (e: never) => void): Ok<A, E>;
  /**
   * No-op on Ok, returns Promise of self.
   *
   * @param _fn Ignored.
   * @returns Promise of self.
   */
  tapErrorAsync(_fn: (e: never) => Promise<void>): Promise<Ok<A, E>>;
  /**
   * Runs ok side effect, skips err side effect, returns self.
   *
   * @param handlers Ok and err side effect handlers.
   * @returns Self.
   * @throws {Panic} If ok handler throws.
   */
  tapBoth(handlers: TapBothOkHandlers<A>): Ok<A, E>;
  /**
   * Runs async ok side effect, skips err side effect, returns self.
   *
   * @param handlers Ok and err async side effect handlers.
   * @returns Promise of self.
   * @throws {Panic} If ok handler throws synchronously or rejects.
   */
  tapBothAsync(handlers: TapBothAsyncOkHandlers<A>): Promise<Ok<A, E>>;
  /**
   * Makes Ok yieldable in Result.gen blocks.
   * Immediately returns the value without yielding.
   * Yield type Err<never, E> matches Err's for proper union inference.
   */
  [Symbol.iterator](): Generator<Err<never, E>, A, unknown>;
}
/**
 * Error result variant.
 *
 * @template T Success type (phantom - for type unification with Ok).
 * @template E Error value type.
 *
 * @example
 * const result = new Err("failed");
 * result.error // "failed"
 * result.status // "error"
 */
declare class Err<T, E> {
  readonly error: E;
  readonly status: "error";
  constructor(error: E);
  /** Returns false, narrowing Result to Ok. */
  isOk(): this is Ok<never, E>;
  /** Returns true, narrowing Result to Err. */
  isErr(): this is Err<T, E>;
  /**
   * No-op on Err, returns self with new phantom T.
   *
   * @template U New phantom success type.
   * @param _fn Ignored.
   * @returns Self.
   */
  map<U>(_fn: (a: never) => U): Err<U, E>;
  /**
   * Transforms error value.
   *
   * @template E2 Transformed error type.
   * @param fn Transformation function.
   * @returns Err with transformed error.
   * @throws {Panic} If fn throws.
   *
   * @example
   * err("fail").mapError(e => new Error(e)) // Err(Error("fail"))
   */
  mapError<E2>(fn: (e: E) => E2): Err<T, E2>;
  /**
   * Attempts to recover from Err into the same success type.
   *
   * @template E2 New error type.
   * @param fn Recovery function returning Result with the same success type.
   * @returns Result from fn.
   * @throws {Panic} If fn throws.
   *
   * @example
   * err("missing").tryRecover(e => e === "missing" ? ok(0) : err(new Error(e))) // Ok(0)
   */
  tryRecover<E2>(fn: (e: E) => Result<T, E2>): Result<T, E2>;
  /**
   * Attempts to recover from Err into the same success type asynchronously.
   *
   * @template E2 New error type.
   * @param fn Async recovery function returning Result with the same success type.
   * @returns Promise of Result from fn.
   * @throws {Panic} If fn throws synchronously or rejects.
   *
   * @example
   * await err("missing").tryRecoverAsync(async e => e === "missing" ? ok(0) : err(new Error(e))) // Ok(0)
   */
  tryRecoverAsync<E2>(fn: (e: E) => Promise<Result<T, E2>>): Promise<Result<T, E2>>;
  /**
   * No-op on Err, returns self with widened error type.
   *
   * @template U New phantom success type.
   * @template E2 Additional error type.
   * @param _fn Ignored.
   * @returns Self.
   */
  andThen<U, E2>(_fn: (a: never) => Result<U, E2>): Err<U, E | E2>;
  /**
   * No-op on Err, returns Promise of self with widened error type.
   *
   * @template U New phantom success type.
   * @template E2 Additional error type.
   * @param _fn Ignored.
   * @returns Promise of self.
   */
  andThenAsync<U, E2>(_fn: (a: never) => Promise<Result<U, E2>>): Promise<Err<U, E | E2>>;
  /**
   * Pattern matches on Result.
   *
   * @template R Return type.
   * @param handlers Ok and err handlers.
   * @returns Result of err handler.
   * @throws {Panic} If handler throws.
   *
   * @example
   * err("fail").match({ ok: x => x, err: e => e.length }) // 4
   */
  match<R>(handlers: {
    ok: (a: never) => R;
    err: (e: E) => R;
  }): R;
  /**
   * Throws error with optional message.
   *
   * @param message Error message.
   * @throws Always throws.
   *
   * @example
   * err("fail").unwrap() // throws Error
   * err("fail").unwrap("custom") // throws Error("custom")
   */
  unwrap(message?: string): never;
  /**
   * Returns fallback value.
   *
   * @template U Fallback type.
   * @param fallback Fallback value.
   * @returns Fallback.
   *
   * @example
   * err("fail").unwrapOr(42) // 42
   */
  unwrapOr<U>(fallback: U): T | U;
  /**
   * No-op on Err, returns self.
   *
   * @param _fn Ignored.
   * @returns Self.
   */
  tap(_fn: (a: never) => void): Err<T, E>;
  /**
   * Runs side effect on error, returns self.
   *
   * @param fn Side effect function.
   * @returns Self.
   * @throws {Panic} If fn throws.
   *
   * @example
   * err("fail").tapError(console.error) // logs "fail", returns Err("fail")
   */
  tapError(fn: (e: E) => void): Err<T, E>;
  /**
   * No-op on Err, returns Promise of self.
   *
   * @param _fn Ignored.
   * @returns Promise of self.
   */
  tapAsync(_fn: (a: never) => Promise<void>): Promise<Err<T, E>>;
  /**
   * Runs async side effect on error, returns self.
   *
   * @param fn Async side effect function.
   * @returns Promise of self.
   * @throws {Panic} If fn throws synchronously or rejects.
   *
   * @example
   * await err("fail").tapErrorAsync(async e => await trace("request.failed", { e }))
   */
  tapErrorAsync(fn: (e: E) => Promise<void>): Promise<Err<T, E>>;
  /**
   * Skips ok side effect, runs err side effect, returns self.
   *
   * @param handlers Ok and err side effect handlers.
   * @returns Self.
   * @throws {Panic} If err handler throws.
   */
  tapBoth(handlers: TapBothErrHandlers<E>): Err<T, E>;
  /**
   * Skips async ok side effect, runs async err side effect, returns self.
   *
   * @param handlers Ok and err async side effect handlers.
   * @returns Promise of self.
   * @throws {Panic} If err handler throws synchronously or rejects.
   */
  tapBothAsync(handlers: TapBothAsyncErrHandlers<E>): Promise<Err<T, E>>;
  /**
   * Makes Err yieldable in Result.gen blocks.
   * Yields Err<never, E> for proper union inference across multiple yields.
   */
  [Symbol.iterator](): Generator<Err<never, E>, never, unknown>;
}
/**
 * Discriminated union representing operation success or failure.
 *
 * Both Ok and Err carry phantom types for the "other" variant:
 * - Ok<T, E>: T is value, E is phantom error type
 * - Err<T, E>: T is phantom success type, E is error
 *
 * This symmetric structure enables proper type inference in generator-based composition.
 *
 * @template T Success value type.
 * @template E Error value type.
 *
 * @example
 * type ParseResult = Result<number, ParseError>;
 */
type Result<T, E> = Ok<T, E> | Err<T, E>;
/**
 * Extracts error type E from yield union in Result.gen.
 * Yields are always Err<never, E>, so we match on that pattern.
 * Distributive conditional: InferYieldErr<Err<never, A> | Err<never, B>> = A | B
 */
type InferYieldErr<Y> = Y extends Err<never, infer E> ? E : never;
/**
 * Infer the Ok value type from a Result.
 * Distributive: InferOk<Ok<A, X> | Ok<B, Y>> = A | B
 */
type InferOk<R> = R extends Ok<infer T, unknown> ? T : never;
/**
 * Infer the Err value type from a Result.
 * Distributive: InferErr<Err<X, A> | Err<Y, B>> = A | B
 */
type InferErr<R> = R extends Err<unknown, infer E> ? E : never;
/**
 * Constraint for any union of Ok/Err types.
 * Used in Result.gen to accept flexible return types from generators.
 */
type AnyResult = Ok<unknown, unknown> | Err<unknown, unknown>;
declare function ok(): Ok<void, never>;
declare function ok<A, E = never>(value: A): Ok<A, E>;
type RetryConfig<E = unknown> = {
  retry?: {
    times: number;
    delayMs: number;
    backoff: "linear" | "constant" | "exponential";
    /** Predicate to determine if an error should trigger a retry. Defaults to always retry. */
    shouldRetry?: (error: E) => boolean;
  };
};
declare function resultAwait<T, E>(promise: Promise<Result<T, E>>): AsyncGenerator<Err<never, E>, T, unknown>;
/** Shape of a serialized Ok over RPC. */
interface SerializedOk<T> {
  status: "ok";
  value: T;
}
/** Shape of a serialized Err over RPC. */
interface SerializedErr<E> {
  status: "error";
  error: E;
}
/** Shape of a serialized Result over RPC. */
type SerializedResult<T, E> = SerializedOk<T> | SerializedErr<E>;
/**
 * Utilities for creating and handling Result types.
 *
 * @example
 * const result = Result.try(() => JSON.parse(str));
 * const value = result.map(x => x.id).unwrapOr("default");
 */
declare const Result: {
  /**
   * Creates successful result.
   *
   * @example
   * Result.ok(42)  // Ok<number, never>
   * Result.ok()    // Ok<void, never> - for side-effectful operations
   */
  readonly ok: typeof ok;
  /**
   * Type guard for Ok.
   *
   * @example
   * if (Result.isOk(result)) { result.value }
   */
  readonly isOk: <A, E>(result: Result<A, E>) => result is Ok<A, E>;
  /**
   * Creates error result.
   *
   * @example
   * Result.err("failed") // Err("failed")
   */
  readonly err: <T = never, E = unknown>(error: E) => Err<T, E>;
  /**
   * Type guard for Err.
   *
   * @example
   * if (Result.isError(result)) { result.error }
   */
  readonly isError: <T, E>(result: Result<T, E>) => result is Err<T, E>;
  /**
   * Executes sync function, wraps result/error in Result.
   *
   * @example
   * Result.try(() => JSON.parse(str))
   * Result.try({ try: () => parse(x), catch: e => new ParseError(e) })
   */
  readonly try: {
    <A>(thunk: () => Awaited<A>, config?: {
      retry?: {
        times: number;
      };
    }): Result<A, UnhandledException>;
    <A, E>(options: {
      try: () => Awaited<A>;
      catch: (cause: unknown) => Awaited<E>;
    }, config?: {
      retry?: {
        times: number;
      };
    }): Result<A, E>;
  };
  /**
   * Executes async function, wraps result/error in Result with retry support.
   *
   * @example
   * // Basic retry
   * await Result.tryPromise(() => fetch(url), {
   *   retry: { times: 3, delayMs: 100, backoff: "exponential" }
   * })
   *
   * @example
   * // Retry only for specific error types (user-defined TaggedError classes)
   * await Result.tryPromise({
   *   try: () => fetch(url),
   *   catch: e => e instanceof TypeError ? new RetryableError(e) : new FatalError(e)
   * }, {
   *   retry: {
   *     times: 3,
   *     delayMs: 100,
   *     backoff: "exponential",
   *     shouldRetry: e => e._tag === "RetryableError"
   *   }
   * })
   *
   * @example
   * // Async retry decisions: enrich error in catch handler
   * await Result.tryPromise({
   *   try: () => callApi(url),
   *   catch: async (e) => {
   *     const limited = await redis.get(`ratelimit:${userId}`);
   *     return new ApiError({ cause: e, rateLimited: !!limited });
   *   }
   * }, {
   *   retry: { times: 3, delayMs: 100, backoff: "exponential", shouldRetry: e => !e.rateLimited }
   * })
   */
  readonly tryPromise: {
    <A>(thunk: () => Promise<A>, config?: RetryConfig<UnhandledException>): Promise<Result<A, UnhandledException>>;
    <A, E>(options: {
      try: () => Promise<A>;
      catch: (cause: unknown) => E | Promise<E>;
    }, config?: RetryConfig<E>): Promise<Result<A, E>>;
  };
  /**
   * Transforms success value, passes error through.
   *
   * @example
   * Result.map(ok(2), x => x * 2) // Ok(4)
   * Result.map(x => x * 2)(ok(2)) // Ok(4)
   */
  readonly map: {
    <A, B, E>(result: Result<A, E>, fn: (a: A) => B): Result<B, E>;
    <A, B>(fn: (a: A) => B): <E>(result: Result<A, E>) => Result<B, E>;
  };
  /**
   * Transforms error value, passes success through.
   *
   * @example
   * Result.mapError(err("fail"), e => new Error(e)) // Err(Error("fail"))
   */
  readonly mapError: {
    <A, E, E2>(result: Result<A, E>, fn: (e: E) => E2): Result<A, E2>;
    <E, E2>(fn: (e: E) => E2): <A>(result: Result<A, E>) => Result<A, E2>;
  };
  /**
   * Attempts to recover from an error into the same success type.
   *
   * @example
   * Result.tryRecover(err("fail"), e => ok(e.length)) // Ok(4)
   * Result.tryRecover(e => ok(e.length))(err("fail")) // Ok(4)
   */
  readonly tryRecover: {
    <A, E, E2>(result: Result<A, E>, fn: (e: E) => Result<A, E2>): Result<A, E2>;
    <E, A, E2>(fn: (e: E) => Result<A, E2>): (result: Result<A, E>) => Result<A, E2>;
  };
  /**
   * Chains Result-returning function on success.
   *
   * @example
   * Result.andThen(ok(2), x => x > 0 ? ok(x) : err("neg")) // Ok(2)
   */
  readonly andThen: {
    <A, B, E, E2>(result: Result<A, E>, fn: (a: A) => Result<B, E2>): Result<B, E | E2>;
    <A, B, E2>(fn: (a: A) => Result<B, E2>): <E>(result: Result<A, E>) => Result<B, E | E2>;
  };
  /**
   * Attempts to recover from an error into the same success type asynchronously.
   *
   * @example
   * await Result.tryRecoverAsync(err("fail"), async e => ok(e.length)) // Ok(4)
   * await Result.tryRecoverAsync(async e => ok(e.length))(err("fail")) // Ok(4)
   */
  readonly tryRecoverAsync: {
    <A, E, E2>(result: Result<A, E>, fn: (e: E) => Promise<Result<A, E2>>): Promise<Result<A, E2>>;
    <E, A, E2>(fn: (e: E) => Promise<Result<A, E2>>): (result: Result<A, E>) => Promise<Result<A, E2>>;
  };
  /**
   * Chains async Result-returning function on success.
   *
   * @example
   * await Result.andThenAsync(ok(1), async x => ok(await fetch(x)))
   */
  readonly andThenAsync: {
    <A, B, E, E2>(result: Result<A, E>, fn: (a: A) => Promise<Result<B, E2>>): Promise<Result<B, E | E2>>;
    <A, B, E2>(fn: (a: A) => Promise<Result<B, E2>>): <E>(result: Result<A, E>) => Promise<Result<B, E | E2>>;
  };
  /**
   * Pattern matches on Result.
   *
   * @example
   * Result.match(ok(2), { ok: x => x * 2, err: () => 0 }) // 4
   */
  readonly match: {
    <A, E, T>(result: Result<A, E>, handlers: {
      ok: (a: A) => T;
      err: (e: E) => T;
    }): T;
    <A, E, T>(handlers: {
      ok: (a: A) => T;
      err: (e: E) => T;
    }): (result: Result<A, E>) => T;
  };
  /**
   * Runs side effect on success value, returns original result.
   *
   * @example
   * Result.tap(ok(2), console.log) // logs 2, returns Ok(2)
   */
  readonly tap: {
    <A, E>(result: Result<A, E>, fn: (a: A) => void): Result<A, E>;
    <A>(fn: (a: A) => void): <E>(result: Result<A, E>) => Result<A, E>;
  };
  /**
   * Runs async side effect on success value, returns original result.
   *
   * @example
   * await Result.tapAsync(ok(2), async x => await log(x))
   */
  readonly tapAsync: {
    <A, E>(result: Result<A, E>, fn: (a: A) => Promise<void>): Promise<Result<A, E>>;
    <A>(fn: (a: A) => Promise<void>): <E>(result: Result<A, E>) => Promise<Result<A, E>>;
  };
  /**
   * Runs side effect on error value, returns original result.
   *
   * @example
   * Result.tapError(err("fail"), console.error) // logs "fail", returns Err("fail")
   * Result.tapError(console.error)(err("fail")) // logs "fail", returns Err("fail")
   */
  readonly tapError: {
    <A, E>(result: Result<A, E>, fn: (e: E) => void): Result<A, E>;
    <E>(fn: (e: E) => void): <A>(result: Result<A, E>) => Result<A, E>;
  };
  /**
   * Runs async side effect on error value, returns original result.
   *
   * @example
   * await Result.tapErrorAsync(err("fail"), async e => await reportError(e))
   * await Result.tapErrorAsync(async e => await reportError(e))(err("fail"))
   */
  readonly tapErrorAsync: {
    <A, E>(result: Result<A, E>, fn: (e: E) => Promise<void>): Promise<Result<A, E>>;
    <E>(fn: (e: E) => Promise<void>): <A>(result: Result<A, E>) => Promise<Result<A, E>>;
  };
  /**
   * Runs side effect on either branch, returns original result.
   *
   * @example
   * Result.tapBoth(ok(2), { ok: console.log, err: console.error })
   * Result.tapBoth({ ok: console.log, err: console.error })(err("fail"))
   */
  readonly tapBoth: {
    <A, E>(result: Result<A, E>, handlers: TapBothHandlers<A, E>): Result<A, E>;
    <A, E>(handlers: TapBothHandlers<A, E>): (result: Result<A, E>) => Result<A, E>;
  };
  /**
   * Runs async side effect on either branch, returns original result.
   *
   * @example
   * await Result.tapBothAsync(ok(2), { ok: async x => await log(x), err: async e => await reportError(e) })
   * await Result.tapBothAsync({ ok: async x => await log(x), err: async e => await reportError(e) })(err("fail"))
   */
  readonly tapBothAsync: {
    <A, E>(result: Result<A, E>, handlers: TapBothAsyncHandlers<A, E>): Promise<Result<A, E>>;
    <A, E>(handlers: TapBothAsyncHandlers<A, E>): (result: Result<A, E>) => Promise<Result<A, E>>;
  };
  /**
   * Extracts value or throws.
   *
   * @example
   * Result.unwrap(ok(42)) // 42
   * Result.unwrap(err("fail")) // throws Error
   */
  readonly unwrap: <A, E>(result: Result<A, E>, message?: string) => A;
  /**
   * Extracts value or returns fallback.
   *
   * @example
   * Result.unwrapOr(ok(42), 0) // 42
   * Result.unwrapOr(err("fail"), 0) // 0
   */
  readonly unwrapOr: {
    <A, E, B>(result: Result<A, E>, fallback: B): A | B;
    <B>(fallback: B): <A, E>(result: Result<A, E>) => A | B;
  };
  /**
   * Generator-based composition for Result types.
   * Errors from yielded Results form a union; use mapError to normalize.
   *
   * @example
   * const result = Result.gen(function* () {
   *   const a = yield* getA(); // Err: ErrorA
   *   const b = yield* getB(a); // Err: ErrorB
   *   return Result.ok({ a, b });
   * });
   * // Result<{a, b}, ErrorA | ErrorB>
   *
   * @example
   * // Normalize error types with mapError
   * const result = Result.gen(function* () {
   *   const a = yield* getA();
   *   const b = yield* getB(a);
   *   return Result.ok({ a, b });
   * }).mapError(e => new UnifiedError(e._tag, e.message));
   * // Result<{a, b}, UnifiedError>
   *
   * @example
   * // Async with Result.await
   * const result = await Result.gen(async function* () {
   *   const a = yield* Result.await(fetchA());
   *   const b = yield* Result.await(fetchB(a));
   *   return Result.ok({ a, b });
   * });
   */
  readonly gen: {
    <Yield extends Err<never, unknown>, R extends AnyResult>(body: () => Generator<Yield, R, unknown>): Result<InferOk<R>, InferYieldErr<Yield> | InferErr<R>>;
    <Yield extends Err<never, unknown>, R extends AnyResult, This>(body: (this: This) => Generator<Yield, R, unknown>, thisArg: This): Result<InferOk<R>, InferYieldErr<Yield> | InferErr<R>>;
    <Yield extends Err<never, unknown>, R extends AnyResult>(body: () => AsyncGenerator<Yield, R, unknown>): Promise<Result<InferOk<R>, InferYieldErr<Yield> | InferErr<R>>>;
    <Yield extends Err<never, unknown>, R extends AnyResult, This>(body: (this: This) => AsyncGenerator<Yield, R, unknown>, thisArg: This): Promise<Result<InferOk<R>, InferYieldErr<Yield> | InferErr<R>>>;
  };
  /**
   * Wraps Promise<Result> to be yieldable in async Result.gen blocks.
   *
   * @example
   * yield* Result.await(fetchUser(id))
   */
  readonly await: typeof resultAwait;
  /**
   * Converts a Result to a plain object for serialization (e.g., RPC, server actions).
   *
   * @example
   * const serialized = Result.serialize(ok(42)); // { status: "ok", value: 42 }
   */
  readonly serialize: <T, E>(result: Result<T, E>) => SerializedResult<T, E>;
  /**
   * Rehydrates serialized Result from RPC back into Ok/Err instances.
   * Returns `Err<ResultDeserializationError>` if the input is not a valid serialized Result.
   *
   * @example
   * // Valid serialized Result
   * const result = Result.deserialize<User, AppError>(rpcResponse);
   * if (Result.isOk(result)) {
   *   console.log(result.value); // User
   * }
   *
   * // Invalid input returns ResultDeserializationError
   * const invalid = Result.deserialize({ foo: "bar" });
   * if (Result.isError(invalid) && ResultDeserializationError.is(invalid.error)) {
   *   console.log("Bad input:", invalid.error.value);
   * }
   */
  readonly deserialize: <T, E>(value: unknown) => Result<T, E | ResultDeserializationError>;
  /**
   * @deprecated Use `Result.deserialize` instead. Will be removed in 3.0.
   */
  readonly hydrate: <T, E>(value: unknown) => Result<T, E | ResultDeserializationError>;
  /**
   * Splits array of Results into tuple of [okValues, errorValues].
   *
   * @example
   * partition([ok(1), err("a"), ok(2)]) // [[1, 2], ["a"]]
   */
  readonly partition: <T, E>(results: readonly Result<T, E>[]) => [T[], E[]];
  /**
   * Flattens nested Result into single Result.
   *
   * @example
   * const nested = Result.ok(Result.ok(42));
   * Result.flatten(nested) // Ok(42)
   */
  readonly flatten: <T, E, E2>(result: Result<Result<T, E>, E2>) => Result<T, E | E2>;
};
//#endregion
export { Err, type InferErr, type InferOk, Ok, Panic, Result, ResultDeserializationError, type SerializedErr, type SerializedOk, type SerializedResult, TaggedError, type TaggedErrorClass, type TaggedErrorInstance, UnhandledException, isPanic, isTaggedError, matchError, matchErrorPartial, panic };
//# sourceMappingURL=index.d.mts.map