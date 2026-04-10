import { ExpressionBuilder, Expression, SqlBool } from 'kysely';
import { a0 as Table, t as AdapterRequirements, o as AdapterQueryOptions, R as Query, L as Either, T as QueryResult } from './adapter-BUw-ZngT.js';

declare const FULL_TABLE_SEARCH_TIMEOUT_MS = 5000;
declare const FULL_TABLE_SEARCH_POSTGRES_LOCK_TIMEOUT_MS = 100;
declare const FULL_TABLE_SEARCH_MYSQL_LOCK_WAIT_TIMEOUT_SECONDS = 1;
declare const FULL_TABLE_SEARCH_MIN_QUERY_LENGTH = 2;
declare const FULL_TABLE_SEARCH_MAX_TEXT_COLUMNS = 64;
declare const FULL_TABLE_SEARCH_TIMEOUT_MESSAGE = "Search timed out after 5 seconds. This kind of search is expensive, and your table might be too large.";
declare class FullTableSearchTimeoutError extends Error {
    constructor();
}
type FullTableSearchDialect = "postgres" | "mysql" | "sqlite";
type FullTableSearchPredicate = {
    column: string;
    kind: "text-like";
    pattern: string;
} | {
    column: string;
    kind: "numeric-equals";
    value: string;
} | {
    column: string;
    kind: "boolean-equals";
    value: boolean;
} | {
    column: string;
    kind: "uuid-equals";
    value: string;
} | {
    column: string;
    kind: "datetime-day-range";
    endExclusive: string;
    startInclusive: string;
} | {
    column: string;
    kind: "time-equals";
    value: string;
};
interface FullTableSearchPlan {
    normalizedSearchTerm: string;
    predicates: FullTableSearchPredicate[];
}
interface FullTableSearchExecutionState {
    activeController: AbortController | null;
    latestRequestId: number;
}
declare function createFullTableSearchExecutionState(): FullTableSearchExecutionState;
declare function isFullTableSearchRequest(searchTerm: string | undefined): boolean;
declare function executeQueryWithFullTableSearchGuardrails<T>(args: {
    executor: AdapterRequirements["executor"];
    options: AdapterQueryOptions;
    query: Query<T>;
    searchTerm: string | undefined;
    state: FullTableSearchExecutionState;
}): Promise<Either<Error, QueryResult<Query<T>>>>;
declare function buildFullTableSearchPlan(args: {
    searchTerm: string | undefined;
    table: Table;
}): FullTableSearchPlan;
declare function getFullTableSearchExpression(plan: FullTableSearchPlan, args: {
    dialect: FullTableSearchDialect;
}): (eb: ExpressionBuilder<any, any>) => Expression<SqlBool>;

export { FULL_TABLE_SEARCH_MAX_TEXT_COLUMNS as F, FULL_TABLE_SEARCH_MIN_QUERY_LENGTH as a, FULL_TABLE_SEARCH_MYSQL_LOCK_WAIT_TIMEOUT_SECONDS as b, FULL_TABLE_SEARCH_POSTGRES_LOCK_TIMEOUT_MS as c, FULL_TABLE_SEARCH_TIMEOUT_MESSAGE as d, FULL_TABLE_SEARCH_TIMEOUT_MS as e, type FullTableSearchDialect as f, type FullTableSearchExecutionState as g, type FullTableSearchPlan as h, type FullTableSearchPredicate as i, FullTableSearchTimeoutError as j, buildFullTableSearchPlan as k, createFullTableSearchExecutionState as l, executeQueryWithFullTableSearchGuardrails as m, getFullTableSearchExpression as n, isFullTableSearchRequest as o };
