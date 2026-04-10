import { DatabaseConnection, DatabaseIntrospector, Dialect, DialectAdapter, Driver, Kysely, QueryCompiler } from "kysely";
import { DatabaseSync } from "node:sqlite";

//#region src/node-sqlite-dialect.d.ts
/**
 * Config for the SQLite dialect.
 */
interface NodeSqliteDialectConfig {
  /**
   * A sqlite DatabaseSync instance or a function that returns one.
   */
  database: DatabaseSync;
  /**
   * Called once when the first query is executed.
   */
  onCreateConnection?: ((connection: DatabaseConnection) => Promise<void>) | undefined;
}
declare class NodeSqliteDialect implements Dialect {
  #private;
  constructor(config: NodeSqliteDialectConfig);
  createDriver(): Driver;
  createQueryCompiler(): QueryCompiler;
  createAdapter(): DialectAdapter;
  createIntrospector(db: Kysely<any>): DatabaseIntrospector;
}
//#endregion
export { NodeSqliteDialect, NodeSqliteDialectConfig };