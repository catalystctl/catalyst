import { Pool } from 'mysql2/promise';
import { V as SequenceExecutor } from '../../adapter-BUw-ZngT.cjs';
import 'kysely';

declare function createMySQL2Executor(pool: Pool): SequenceExecutor;

export { createMySQL2Executor };
