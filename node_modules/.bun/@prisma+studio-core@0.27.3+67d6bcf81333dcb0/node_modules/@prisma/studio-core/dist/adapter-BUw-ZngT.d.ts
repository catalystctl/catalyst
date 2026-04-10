import { WhereInterface, DialectAdapter, QueryCompiler } from 'kysely';

interface BuilderRequirements {
    Adapter: {
        new (): DialectAdapter;
    };
    noParameters?: boolean;
    QueryCompiler: {
        new (): QueryCompiler;
    };
}
declare const queryType: unique symbol;
interface Query<T = Record<string, unknown>> {
    [queryType]?: T;
    parameters: readonly unknown[];
    sql: string;
    transformations?: Partial<Record<keyof T, "json-parse">>;
}
type QueryResult<T> = T extends Query<infer R> ? R[] : T extends (...args: any[]) => Query<infer R> ? R[] : never;
/**
 * Applies a filter to the given rows based on the primary key columns of the table.
 *
 * @example db.selectFrom("users").$call(applyInferredRowFilters(rows, columns)).selectAll()
 */
declare function applyInferredRowFilters(rows: Record<string, unknown>[], columns: Table["columns"]): <QB extends WhereInterface<any, any>>(qb: QB) => QB;

type Either<E, R> = [E] | [null, R];
type NumericString = `${number}`;
type BigIntString = `${bigint}`;

interface Executor {
    execute<T>(query: Query<T>, options?: ExecuteOptions): Promise<Either<Error, QueryResult<Query<T>>>>;
    executeTransaction?(queries: readonly Query<unknown>[], options?: ExecuteOptions): Promise<Either<Error, QueryResult<Query<unknown>>[]>>;
    /**
     * Optional SQL lint transport for parse/plan diagnostics.
     *
     * Executors that do not implement this capability can still be used by
     * adapters with fallback lint strategies.
     */
    lintSql?(details: SqlLintDetails, options?: ExecuteOptions): Promise<Either<Error, SqlLintResult>>;
}
interface SequenceExecutor extends Executor {
    executeSequence<T, S>(sequence: readonly [Query<T>, Query<S>], options?: ExecuteOptions): Promise<[[Error]] | [[null, QueryResult<Query<T>>], Either<Error, QueryResult<Query<S>>>]>;
}
interface ExecuteOptions {
    abortSignal?: AbortSignal;
}
interface SqlLintDetails {
    schemaVersion?: string;
    sql: string;
}
interface SqlLintDiagnostic {
    code?: string;
    from: number;
    message: string;
    severity: "error" | "warning" | "info" | "hint";
    source?: string;
    to: number;
}
interface SqlLintResult {
    diagnostics: SqlLintDiagnostic[];
    schemaVersion?: string;
}
declare class AbortError extends Error {
    constructor();
}
declare function getAbortResult(): [AbortError];

interface AdapterRequirements {
    executor: Executor;
    noParameters?: boolean;
}
interface AdapterCapabilities {
    /**
     * Whether full-table content search is supported by this adapter.
     */
    fullTableSearch: boolean;
    /**
     * SQL dialect used by SQL editor highlighting/autocomplete.
     */
    sqlDialect: SqlEditorDialect;
    /**
     * Whether SQL editor schema-aware autocomplete is supported.
     */
    sqlEditorAutocomplete: boolean;
    /**
     * Whether SQL editor lint diagnostics are supported.
     */
    sqlEditorLint: boolean;
}
interface Adapter {
    /**
     * The schema studio will choose by default.
     *
     * e.g. `public` for PostgreSQL
     */
    readonly defaultSchema?: string;
    /**
     * Optional adapter feature flags used by the UI.
     */
    readonly capabilities?: Partial<AdapterCapabilities>;
    /**
     * Introspects the database and returns structured information about the schemas, tables, etc.
     *
     * @param options - Options for the introspection request.
     */
    introspect(options: AdapterIntrospectOptions): Promise<Either<AdapterError, AdapterIntrospectResult>>;
    /**
     * Executes a structured query against the database.
     */
    query(details: AdapterQueryDetails, options: AdapterQueryOptions): Promise<Either<AdapterError, AdapterQueryResult>>;
    /**
     * Executes raw SQL against the database.
     */
    raw(details: AdapterRawDetails, options: AdapterRawOptions): Promise<Either<AdapterError, AdapterRawResult>>;
    /**
     * Returns schema metadata for SQL editor autocomplete.
     */
    sqlSchema?(details: AdapterSqlSchemaDetails, options: AdapterSqlSchemaOptions): Promise<Either<AdapterError, AdapterSqlSchemaResult>>;
    /**
     * Returns SQL editor diagnostics (syntax/schema linting).
     */
    sqlLint?(details: AdapterSqlLintDetails, options: AdapterSqlLintOptions): Promise<Either<AdapterError, AdapterSqlLintResult>>;
    /**
     * Inserts a single row into the database.
     */
    insert(details: AdapterInsertDetails, options: AdapterInsertOptions): Promise<Either<AdapterError, AdapterInsertResult>>;
    /**
     * Updates a given row in the database with given changes.
     */
    update(details: AdapterUpdateDetails, options: AdapterUpdateOptions): Promise<Either<AdapterError, AdapterUpdateResult>>;
    /**
     * Updates multiple rows in the database inside one adapter-level transaction
     * when supported by the executor.
     */
    updateMany?(details: AdapterUpdateManyDetails, options: AdapterUpdateOptions): Promise<Either<AdapterError, AdapterUpdateManyResult>>;
    /**
     * Deletes given rows from the database.
     */
    delete(details: AdapterDeleteDetails, options: AdapterDeleteOptions): Promise<Either<AdapterError, AdapterDeleteResult>>;
}
interface AdapterBaseOptions {
}
interface AdapterIntrospectOptions extends AdapterBaseOptions {
}
interface AdapterQueryOptions extends AdapterBaseOptions {
    abortSignal: AbortSignal;
}
interface AdapterRawOptions extends AdapterBaseOptions {
    abortSignal: AbortSignal;
}
interface AdapterSqlSchemaOptions extends AdapterBaseOptions {
}
interface AdapterSqlLintOptions extends AdapterBaseOptions {
    abortSignal: AbortSignal;
}
interface AdapterInsertOptions extends AdapterBaseOptions {
}
interface AdapterUpdateOptions extends AdapterBaseOptions {
}
interface AdapterDeleteOptions extends AdapterBaseOptions {
}
type SchemaName = string;
interface AdapterIntrospectResult {
    schemas: Record<SchemaName, Schema>;
    timezone: string;
    filterOperators: FilterOperator[];
    query: Query;
}
type TableName = string;
interface Schema {
    name: string;
    tables: Record<TableName, Table>;
}
type ColumnName = string;
interface Table {
    columns: Record<ColumnName, Column>;
    name: TableName;
    schema: SchemaName;
}
interface Column {
    datatype: DataType;
    defaultValue: "CURRENT_DATE" | "CURRENT_TIME" | "CURRENT_TIMESTAMP" | "datetime('now')" | "gen_random_uuid()" | "json_array()" | `nextval(${string})` | `now()` | "uuid_to_bin(uuid())" | "uuid()" | (string & {}) | null;
    fkColumn: ColumnName | null;
    fkSchema: SchemaName | null;
    fkTable: TableName | null;
    isAutoincrement: boolean;
    isComputed: boolean;
    isRequired: boolean;
    name: ColumnName;
    nullable: boolean;
    pkPosition: number | null;
    schema: SchemaName;
    table: TableName;
}
interface DataType {
    /**
     * The database-specific affinity/type.
     *
     * e.g. in SQLite, datatypes can be anything. They are reduced to affinity via string matching rules.
     *
     * {@link https://sqlite.org/datatype3.html#determination_of_column_affinity}
     */
    affinity?: string;
    /**
     * The database-specific format for the datatype.
     */
    format?: string;
    /**
     * A simplification/normalization for UI usage.
     *
     * e.g. varchar and char are strings.
     */
    group: DataTypeGroup;
    /**
     * Is this a native array type?
     */
    isArray: boolean;
    /**
     * Is a native database datatype or a user-defined datatype?
     *
     * e.g. PostgreSQL enums are user-defined datatypes, but `int4` is a native datatype.
     */
    isNative: boolean;
    /**
     * Will be displayed as-is.
     */
    name: string;
    /**
     * Enum values for enum types.
     */
    options: string[];
    /**
     * The schema the datatype belongs to.
     */
    schema: string;
}
type DataTypeGroup = "string" | "datetime" | "boolean" | "enum" | "time" | "raw" | "numeric" | "json";
interface AdapterQueryDetails {
    /**
     * Zero-based index of the page to fetch.
     */
    pageIndex: number;
    /**
     * Maximum number of rows to fetch from the database.
     */
    pageSize: number;
    /**
     * Sort order for the query.
     */
    sortOrder: SortOrderItem[];
    /**
     * The table to select from.
     */
    table: Table;
    /**
     * The filter to be applied.
     */
    filter?: FilterGroup;
    /**
     * Optional full-table content search term.
     *
     * This is interpreted by database-specific adapters and composed into the
     * generated SQL query.
     */
    fullTableSearchTerm?: string;
}
type FilterOperator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "is" | "is not" | "like" | "not like" | "ilike" | "not ilike";
interface ColumnFilter {
    kind: "ColumnFilter";
    column: string;
    operator: FilterOperator;
    value: unknown;
    after: "and" | "or";
    id: string;
}
interface SqlFilter {
    kind: "SqlFilter";
    sql: string;
    after: "and" | "or";
    id: string;
}
interface FilterGroup {
    kind: "FilterGroup";
    filters: (ColumnFilter | FilterGroup | SqlFilter)[];
    after: "and" | "or";
    id: string;
}
interface SortOrderItem {
    /**
     * The column to sort by.
     */
    column: ColumnName;
    /**
     * The direction to sort the column by.
     */
    direction: SortDirection;
}
type SortDirection = "asc" | "desc";
declare class AdapterError extends Error {
    adapterSource?: string;
    query?: Query<unknown>;
}
interface AdapterQueryResult {
    /**
     * The total number of rows the query would return if not limited.
     *
     * If the database does not support counting rows, this should be set to `Infinity`.
     */
    filteredRowCount: number | bigint | NumericString | BigIntString;
    /**
     * The rows returned by the query.
     */
    rows: Record<ColumnName, unknown>[];
    /**
     * The executed query string.
     */
    query: Query;
}
interface AdapterRawDetails {
    sql: string;
}
interface AdapterRawResult {
    rowCount: number;
    rows: Record<string, unknown>[];
    query: Query;
}
interface AdapterSqlSchemaDetails {
}
interface AdapterSqlSchemaResult {
    defaultSchema?: string;
    dialect: SqlEditorDialect;
    namespace: Record<string, Record<string, string[]>>;
    version: string;
}
interface AdapterSqlLintDetails {
    schemaVersion?: string;
    sql: string;
}
interface AdapterSqlLintDiagnostic {
    code?: string;
    from: number;
    message: string;
    severity: "error" | "warning" | "info" | "hint";
    source?: string;
    to: number;
}
interface AdapterSqlLintResult {
    diagnostics: AdapterSqlLintDiagnostic[];
    schemaVersion?: string;
}
type SqlEditorDialect = "postgresql" | "mysql" | "sqlite";
interface AdapterInsertDetails {
    /**
     * The table to insert into.
     */
    table: Table;
    /**
     * The values to insert into the table.
     * - The keys should match the column names in the table.
     * - The values should be the values to insert into the table.
     */
    rows: Record<string, unknown>[];
}
interface AdapterInsertResult {
    /**
     * The freshly inserted row data.
     */
    rows: Record<string, unknown>[];
    /**
     * The executed query string.
     */
    query: Query<unknown>;
}
interface AdapterUpdateDetails {
    /**
     * Changes to apply to the row.
     */
    changes: Record<ColumnName, unknown>;
    /**
     * The row to update.
     */
    row: Record<ColumnName, unknown>;
    /**
     * The table to update in.
     */
    table: Table;
}
interface AdapterUpdateManyDetails {
    /**
     * The updates to apply to existing rows.
     */
    updates: AdapterUpdateDetails[];
    /**
     * The table to update in.
     */
    table: Table;
}
interface AdapterUpdateResult {
    /**
     * The updated row data.
     */
    row: Record<ColumnName, unknown> & {
        /**
         * When the changes were applied in database time.
         */
        __ps_updated_at__: string | number | Date;
    };
    /**
     * The executed query string.
     */
    query: Query<unknown>;
}
interface AdapterUpdateManyResult {
    /**
     * The updated row data in the same order as the requested updates.
     */
    rows: AdapterUpdateResult["row"][];
    /**
     * The executed queries that were run inside the transaction.
     */
    queries: Query<unknown>[];
}
interface AdapterDeleteDetails {
    /**
     * The rows to delete.
     */
    rows: Record<ColumnName, unknown>[];
    /**
     * The table to delete from.
     */
    table: Table;
}
interface AdapterDeleteResult {
    rows: Record<ColumnName, unknown>[];
    /**
     * The executed query string.
     */
    query: Query<unknown>;
}
declare function createAdapterError(args: {
    adapterSource?: string;
    error: Error;
    query?: Query<unknown>;
}): [AdapterError];

export { type SqlLintResult as $, type AdapterIntrospectResult as A, type AdapterUpdateDetails as B, type AdapterUpdateManyDetails as C, type AdapterUpdateManyResult as D, type AdapterUpdateOptions as E, type AdapterUpdateResult as F, type BigIntString as G, type Column as H, type ColumnFilter as I, type DataType as J, type DataTypeGroup as K, type Either as L, type ExecuteOptions as M, type Executor as N, type FilterGroup as O, type FilterOperator as P, type NumericString as Q, type Query as R, type SqlEditorDialect as S, type QueryResult as T, type Schema as U, type SequenceExecutor as V, type SortDirection as W, type SortOrderItem as X, type SqlFilter as Y, type SqlLintDetails as Z, type SqlLintDiagnostic as _, type AdapterSqlSchemaResult as a, type Table as a0, applyInferredRowFilters as a1, createAdapterError as a2, getAbortResult as a3, type BuilderRequirements as a4, AbortError as b, type Adapter as c, type AdapterBaseOptions as d, type AdapterCapabilities as e, type AdapterDeleteDetails as f, type AdapterDeleteOptions as g, type AdapterDeleteResult as h, AdapterError as i, type AdapterInsertDetails as j, type AdapterInsertOptions as k, type AdapterInsertResult as l, type AdapterIntrospectOptions as m, type AdapterQueryDetails as n, type AdapterQueryOptions as o, type AdapterQueryResult as p, type AdapterRawDetails as q, type AdapterRawOptions as r, type AdapterRawResult as s, type AdapterRequirements as t, type AdapterSqlLintDetails as u, type AdapterSqlLintDiagnostic as v, type AdapterSqlLintOptions as w, type AdapterSqlLintResult as x, type AdapterSqlSchemaDetails as y, type AdapterSqlSchemaOptions as z };
