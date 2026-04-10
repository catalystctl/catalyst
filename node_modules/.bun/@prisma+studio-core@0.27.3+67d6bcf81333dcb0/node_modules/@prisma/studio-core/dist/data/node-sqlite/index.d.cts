import { DatabaseSync } from 'node:sqlite';
import { N as Executor } from '../../adapter-BUw-ZngT.cjs';
import 'kysely';

declare function createNodeSQLiteExecutor(database: DatabaseSync): Executor;

export { createNodeSQLiteExecutor };
