import { V as SequenceExecutor, R as Query, M as ExecuteOptions, L as Either, T as QueryResult, v as AdapterSqlLintDiagnostic } from '../../adapter-BUw-ZngT.js';
import 'kysely';

declare function consumeBffRequestDurationMsForSignal(abortSignal: AbortSignal): number | null;
interface StudioBFFClientProps {
    /**
     * Allows passing custom headers to the BFF.
     *
     * e.g. authorization token.
     */
    customHeaders?: Record<string, string>;
    /**
     * Allows passing custom payload to the BFF via `body.customPayload`.
     *
     * e.g. tenant id.
     */
    customPayload?: Record<string, unknown>;
    /**
     * Allows overriding the fetch function implementation.
     *
     * e.g. for testing, or older Node.js versions.
     */
    fetch?: typeof globalThis.fetch;
    /**
     * Function used to deserialize the results of queries.
     *
     * By default, the results are returned as is without any additional processing.
     */
    resultDeserializerFn?(this: void, results: unknown): unknown[];
    /**
     * BFF endpoint URL.
     *
     * e.g. `https://api.example.com/studio`
     */
    url: string | URL;
}
interface StudioBFFClient extends SequenceExecutor {
    /**
     * Requests BFF to query the database.
     *
     * The query is sent as `body.query`.
     */
    execute<T>(this: void, query: Query<T>, options?: ExecuteOptions): Promise<Either<Error, QueryResult<Query<T>>>>;
    /**
     * Requests BFF to execute a sequence of queries.
     *
     * The sequence is sent as `body.sequence`.
     */
    executeSequence<T, S>(this: void, sequence: readonly [Query<T>, Query<S>], options?: ExecuteOptions): Promise<[[Error]] | [[null, QueryResult<Query<T>>], Either<Error, QueryResult<Query<S>>>]>;
    /**
     * Requests BFF to execute a transactional batch of queries.
     *
     * The queries are sent as `body.queries`.
     */
    executeTransaction(this: void, queries: readonly Query<unknown>[], options?: ExecuteOptions): Promise<Either<Error, QueryResult<Query<unknown>>[]>>;
    /**
     * Requests BFF to lint SQL via parse/plan diagnostics.
     */
    lintSql(this: void, details: StudioBFFSqlLintDetails, options?: ExecuteOptions): Promise<Either<Error, StudioBFFSqlLintResult>>;
}
type StudioBFFRequest = StudioBFFQueryRequest | StudioBFFSequenceRequest | StudioBFFTransactionRequest | StudioBFFSqlLintRequest;
interface StudioBFFQueryRequest {
    customPayload?: Record<string, unknown>;
    procedure: "query";
    query: Query<unknown>;
}
interface StudioBFFSequenceRequest {
    customPayload?: Record<string, unknown>;
    procedure: "sequence";
    sequence: readonly [Query<unknown>, Query<unknown>];
}
interface StudioBFFTransactionRequest {
    customPayload?: Record<string, unknown>;
    procedure: "transaction";
    queries: readonly Query<unknown>[];
}
interface StudioBFFSqlLintDetails {
    schemaVersion?: string;
    sql: string;
}
interface StudioBFFSqlLintResult {
    diagnostics: AdapterSqlLintDiagnostic[];
    schemaVersion?: string;
}
interface StudioBFFSqlLintRequest {
    customPayload?: Record<string, unknown>;
    procedure: "sql-lint";
    schemaVersion?: string;
    sql: string;
}
/**
 * Creates a Studio BFF client. BFF stands for "Backend For Frontend" btw.
 */
declare function createStudioBFFClient(props: StudioBFFClientProps): StudioBFFClient;
interface SerializedError {
    message: string;
    name: string;
    errors?: SerializedError[];
}
declare function serializeError(error: unknown): SerializedError;
declare function deserializeError(error: SerializedError): Error;

export { type SerializedError, type StudioBFFClient, type StudioBFFClientProps, type StudioBFFQueryRequest, type StudioBFFRequest, type StudioBFFSequenceRequest, type StudioBFFSqlLintDetails, type StudioBFFSqlLintRequest, type StudioBFFSqlLintResult, type StudioBFFTransactionRequest, consumeBffRequestDurationMsForSignal, createStudioBFFClient, deserializeError, serializeError };
