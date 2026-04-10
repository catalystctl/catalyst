import { Sql } from 'postgres';
import { N as Executor } from '../../adapter-BUw-ZngT.cjs';
import 'kysely';

declare function createPostgresJSExecutor(postgresjs: Sql): Executor;

export { createPostgresJSExecutor };
