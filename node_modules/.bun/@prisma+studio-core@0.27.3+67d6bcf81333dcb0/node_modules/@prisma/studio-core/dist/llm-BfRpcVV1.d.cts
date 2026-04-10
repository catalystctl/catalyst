declare const STUDIO_LLM_TASKS: readonly ["table-filter", "sql-generation", "sql-visualization"];
type StudioLlmTask = (typeof STUDIO_LLM_TASKS)[number];
declare const STUDIO_LLM_ERROR_CODES: readonly ["cancelled", "not-configured", "output-limit-exceeded", "request-failed"];
type StudioLlmErrorCode = (typeof STUDIO_LLM_ERROR_CODES)[number];
interface StudioLlmRequest {
    prompt: string;
    task: StudioLlmTask;
}
interface StudioLlmSuccessResponse {
    ok: true;
    text: string;
}
interface StudioLlmErrorResponse {
    code: StudioLlmErrorCode;
    message: string;
    ok: false;
}
type StudioLlmResponse = StudioLlmSuccessResponse | StudioLlmErrorResponse;
type StudioLlm = (request: StudioLlmRequest) => Promise<StudioLlmResponse>;
declare class StudioLlmError extends Error {
    code: StudioLlmErrorCode;
    constructor(args: {
        code: StudioLlmErrorCode;
        message: string;
    });
}
declare function buildStudioLlmOutputLimitExceededMessage(args: {
    maxTokens: number;
    provider: string;
}): string;
declare function isStudioLlmResponse(value: unknown): value is StudioLlmResponse;
declare function readStudioLlmOutputLimitExceededMessage(value: unknown): string | null;

export { STUDIO_LLM_ERROR_CODES as S, STUDIO_LLM_TASKS as a, type StudioLlm as b, StudioLlmError as c, type StudioLlmErrorCode as d, type StudioLlmErrorResponse as e, type StudioLlmRequest as f, type StudioLlmResponse as g, type StudioLlmSuccessResponse as h, type StudioLlmTask as i, buildStudioLlmOutputLimitExceededMessage as j, isStudioLlmResponse as k, readStudioLlmOutputLimitExceededMessage as r };
