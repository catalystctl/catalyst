import { Database } from 'sql.js';
import { N as Executor } from '../../adapter-BUw-ZngT.js';
import 'kysely';

declare function createSQLJSExecutor(database: Database): Executor;

export { createSQLJSExecutor };
