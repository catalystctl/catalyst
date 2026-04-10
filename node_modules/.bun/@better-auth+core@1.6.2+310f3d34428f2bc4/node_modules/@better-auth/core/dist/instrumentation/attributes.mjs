import { ATTR_DB_COLLECTION_NAME, ATTR_DB_OPERATION_NAME, ATTR_HTTP_RESPONSE_STATUS_CODE, ATTR_HTTP_ROUTE } from "@opentelemetry/semantic-conventions";
//#region src/instrumentation/attributes.ts
/** Operation identifier (e.g. getSession, signUpWithEmailAndPassword). Uses endpoint operationId when set, otherwise the endpoint key. */
const ATTR_OPERATION_ID = "better_auth.operation_id";
/** Hook type (e.g. before, after, create.before). */
const ATTR_HOOK_TYPE = "better_auth.hook.type";
/** Execution context (e.g. user, plugin:id). */
const ATTR_CONTEXT = "better_auth.context";
//#endregion
export { ATTR_CONTEXT, ATTR_DB_COLLECTION_NAME, ATTR_DB_OPERATION_NAME, ATTR_HOOK_TYPE, ATTR_HTTP_RESPONSE_STATUS_CODE, ATTR_HTTP_ROUTE, ATTR_OPERATION_ID };
