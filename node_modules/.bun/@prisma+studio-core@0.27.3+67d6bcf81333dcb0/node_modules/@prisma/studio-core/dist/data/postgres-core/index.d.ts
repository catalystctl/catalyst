import { t as AdapterRequirements, c as Adapter, a0 as Table, P as FilterOperator, R as Query, f as AdapterDeleteDetails, a4 as BuilderRequirements, j as AdapterInsertDetails, n as AdapterQueryDetails, B as AdapterUpdateDetails, v as AdapterSqlLintDiagnostic } from '../../adapter-BUw-ZngT.js';
import { h as FullTableSearchPlan } from '../../full-table-search-CBIeucRq.js';
export { F as FULL_TABLE_SEARCH_MAX_TEXT_COLUMNS, a as FULL_TABLE_SEARCH_MIN_QUERY_LENGTH, b as FULL_TABLE_SEARCH_MYSQL_LOCK_WAIT_TIMEOUT_SECONDS, c as FULL_TABLE_SEARCH_POSTGRES_LOCK_TIMEOUT_MS, d as FULL_TABLE_SEARCH_TIMEOUT_MESSAGE, e as FULL_TABLE_SEARCH_TIMEOUT_MS, f as FullTableSearchDialect, g as FullTableSearchExecutionState, i as FullTableSearchPredicate, j as FullTableSearchTimeoutError, l as createFullTableSearchExecutionState, m as executeQueryWithFullTableSearchGuardrails, n as getFullTableSearchExpression, o as isFullTableSearchRequest } from '../../full-table-search-CBIeucRq.js';
import 'kysely';

type PostgresAdapterRequirements = AdapterRequirements;
declare function createPostgresAdapter(requirements: PostgresAdapterRequirements): Adapter;
/**
 * For testing purposes.
 */
declare function mockIntrospect(): {
    schemas: { [K in "zoo" | "public"]: {
        name: K;
        tables: { [T in "animals" | "users" | "composite_pk"]: Table; };
    }; };
    timezone: "UTC";
    filterOperators: FilterOperator[];
    query: Query;
};

/**
 * Inserts one or more rows into a table and returns the inserted rows along with their `ctid`.
 */
declare function getInsertQuery(details: AdapterInsertDetails, requirements?: Omit<BuilderRequirements, "Adapter" | "QueryCompiler">): Query<{
    [x: string]: unknown;
} & {
    __ps_inserted_at__: `${bigint}`;
}>;
/**
 * Returns a query that selects all columns from a table, along with an unbound row count as `__ps_count__`.
 */
declare function getSelectQuery(details: AdapterQueryDetails, requirements?: Omit<BuilderRequirements, "Adapter" | "QueryCompiler">): Query<{
    [x: string]: unknown;
    __ps_count__: `${bigint}`;
}>;
/**
 * For testing purposes.
 */
declare function mockSelectQuery(): [{
    readonly created_at: Date;
    readonly deleted_at: null;
    readonly id: 1;
    readonly name: "John Doe";
    readonly __ps_count__: "2";
    readonly role: "admin";
    readonly name_role: "Jonn Doe - admin";
}, {
    readonly created_at: Date;
    readonly deleted_at: null;
    readonly id: 2;
    readonly name: "Jane Doe";
    readonly __ps_count__: "2";
    readonly role: "poweruser";
    readonly name_role: "Jane Doe - poweruser";
}];
/**
 * Returns a query that updates a given row in a table with given changes.
 */
declare function getUpdateQuery(details: AdapterUpdateDetails, requirements?: Omit<BuilderRequirements, "Adapter" | "QueryCompiler">): Query<{
    [x: string]: unknown;
    __ps_updated_at__: `${bigint}`;
}>;
/**
 * Returns a query that deletes a given set of rows.
 */
declare function getDeleteQuery(details: AdapterDeleteDetails, requirements?: Omit<BuilderRequirements, "Adapter" | "QueryCompiler">): Query<{
    [x: string]: unknown;
    __ps_deleted_at__: `${bigint}`;
}>;

declare function buildFullTableSearchPlan(args: {
    searchTerm: string | undefined;
    table: Table;
}): FullTableSearchPlan;

/**
 * Returns a query that returns metadata for all user-defined tables and views in the database.
 */
declare function getTablesQuery(requirements?: Omit<BuilderRequirements, "Adapter" | "QueryCompiler">): Query<{
    schema: string;
    name: string;
    columns: {
        name: string;
        fk_column: string | null;
        fk_table: string | null;
        fk_schema: string | null;
        datatype_schema: string;
        datatype: string;
        autoinc: boolean;
        computed: boolean;
        default: string | null;
        nullable: boolean;
        options: string[];
        pk: number | null;
    }[];
}>;
/**
 * For testing purposes.
 */
declare function mockTablesQuery(): [{
    readonly schema: "zoo";
    readonly name: "animals";
    readonly columns: [{
        readonly autoinc: true;
        readonly computed: false;
        readonly datatype: "int4";
        readonly datatype_schema: "pg_catalog";
        readonly default: "nextval('zoo.animals_id_seq'::regclass)";
        readonly fk_column: null;
        readonly fk_schema: null;
        readonly fk_table: null;
        readonly name: "id";
        readonly nullable: false;
        readonly options: [];
        readonly pk: 1;
    }, {
        readonly autoinc: false;
        readonly computed: false;
        readonly datatype: "text";
        readonly datatype_schema: "pg_catalog";
        readonly default: null;
        readonly fk_column: null;
        readonly fk_schema: null;
        readonly fk_table: null;
        readonly name: "name";
        readonly nullable: true;
        readonly options: [];
        readonly pk: null;
    }];
}, {
    readonly schema: "public";
    readonly name: "users";
    readonly columns: [{
        readonly autoinc: true;
        readonly computed: false;
        readonly datatype: "int4";
        readonly datatype_schema: "pg_catalog";
        readonly default: "nextval('users_id_seq'::regclass)";
        readonly fk_column: null;
        readonly fk_schema: null;
        readonly fk_table: null;
        readonly name: "id";
        readonly nullable: false;
        readonly options: [];
        readonly pk: 1;
    }, {
        readonly autoinc: false;
        readonly computed: false;
        readonly datatype: "timestamp";
        readonly datatype_schema: "pg_catalog";
        readonly default: "CURRENT_TIMESTAMP";
        readonly fk_column: null;
        readonly fk_schema: null;
        readonly fk_table: null;
        readonly name: "created_at";
        readonly nullable: true;
        readonly options: [];
        readonly pk: null;
    }, {
        readonly autoinc: false;
        readonly computed: false;
        readonly datatype: "timestamp";
        readonly datatype_schema: "pg_catalog";
        readonly default: null;
        readonly fk_column: null;
        readonly fk_schema: null;
        readonly fk_table: null;
        readonly name: "deleted_at";
        readonly nullable: true;
        readonly options: [];
        readonly pk: null;
    }, {
        readonly autoinc: false;
        readonly computed: false;
        readonly datatype: "varchar";
        readonly datatype_schema: "pg_catalog";
        readonly default: null;
        readonly fk_column: null;
        readonly fk_schema: null;
        readonly fk_table: null;
        readonly name: "role";
        readonly nullable: true;
        readonly options: [];
        readonly pk: null;
    }, {
        readonly autoinc: false;
        readonly computed: false;
        readonly datatype: "varchar";
        readonly datatype_schema: "pg_catalog";
        readonly default: null;
        readonly fk_column: null;
        readonly fk_schema: null;
        readonly fk_table: null;
        readonly name: "name";
        readonly nullable: true;
        readonly options: [];
        readonly pk: null;
    }, {
        readonly autoinc: false;
        readonly computed: true;
        readonly datatype: "text";
        readonly datatype_schema: "pg_catalog";
        readonly default: null;
        readonly fk_column: null;
        readonly fk_schema: null;
        readonly fk_table: null;
        readonly name: "name_role";
        readonly nullable: false;
        readonly options: [];
        readonly pk: null;
    }];
}, {
    readonly schema: "public";
    readonly name: "composite_pk";
    readonly columns: [{
        readonly autoinc: false;
        readonly computed: false;
        readonly datatype: "uuid";
        readonly datatype_schema: "pg_catalog";
        readonly default: "gen_random_uuid()";
        readonly fk_column: null;
        readonly fk_schema: null;
        readonly fk_table: null;
        readonly name: "id";
        readonly nullable: false;
        readonly options: [];
        readonly pk: 1;
    }, {
        readonly autoinc: false;
        readonly computed: false;
        readonly datatype: "text";
        readonly datatype_schema: "pg_catalog";
        readonly default: null;
        readonly fk_column: null;
        readonly fk_schema: null;
        readonly fk_table: null;
        readonly name: "name";
        readonly nullable: true;
        readonly options: [];
        readonly pk: 2;
    }, {
        readonly autoinc: false;
        readonly computed: false;
        readonly datatype: "timestamp";
        readonly datatype_schema: "pg_catalog";
        readonly default: "now()";
        readonly fk_column: null;
        readonly fk_schema: null;
        readonly fk_table: null;
        readonly name: "created_at";
        readonly nullable: true;
        readonly options: [];
        readonly pk: null;
    }];
}];
/**
 * Returns a query that returns the current timezone setting of the PostgreSQL database.
 */
declare function getTimezoneQuery(): Query<{
    timezone: string;
}>;
/**
 * For testing purposes.
 */
declare function mockTimezoneQuery(): [{
    readonly timezone: "UTC";
}];

declare const SQL_LINT_MAX_LENGTH: number;
declare const SQL_LINT_ALLOWED_STATEMENT_KEYWORDS: Set<string>;
interface SqlLintValidatedStatement {
    from: number;
    statement: string;
    to: number;
}
type SqlLintValidationResult = {
    ok: true;
    statements: SqlLintValidatedStatement[];
} | {
    diagnostic: AdapterSqlLintDiagnostic;
    ok: false;
};
declare function validateSqlForLint(sql: string): SqlLintValidationResult;
declare function createLintDiagnosticsFromPostgresError(args: {
    error: unknown;
    positionOffset?: number;
    sql: string;
}): AdapterSqlLintDiagnostic[];

declare function getPIDQuery(): Query<{
    pid: unknown;
}>;
declare function getCancelQuery(pid: {}): Query<unknown>;

export { type PostgresAdapterRequirements, SQL_LINT_ALLOWED_STATEMENT_KEYWORDS, SQL_LINT_MAX_LENGTH, type SqlLintValidatedStatement, type SqlLintValidationResult, buildFullTableSearchPlan, createLintDiagnosticsFromPostgresError, createPostgresAdapter, getCancelQuery, getDeleteQuery, getInsertQuery, getPIDQuery, getSelectQuery, getTablesQuery, getTimezoneQuery, getUpdateQuery, mockIntrospect, mockSelectQuery, mockTablesQuery, mockTimezoneQuery, validateSqlForLint };
