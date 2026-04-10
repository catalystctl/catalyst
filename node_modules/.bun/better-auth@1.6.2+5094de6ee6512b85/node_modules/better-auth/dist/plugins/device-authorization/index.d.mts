import { TimeString, ms, sec } from "../../utils/time.mjs";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";
import * as better_call0 from "better-call";
import * as z from "zod";

//#region src/plugins/device-authorization/index.d.ts
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    "device-authorization": {
      creator: typeof deviceAuthorization;
    };
  }
}
declare const deviceAuthorizationOptionsSchema: z.ZodObject<{
  expiresIn: z.ZodDefault<z.ZodCustom<TimeString, TimeString>>;
  interval: z.ZodDefault<z.ZodCustom<TimeString, TimeString>>;
  deviceCodeLength: z.ZodDefault<z.ZodNumber>;
  userCodeLength: z.ZodDefault<z.ZodNumber>;
  generateDeviceCode: z.ZodOptional<z.ZodCustom<() => string | Promise<string>, () => string | Promise<string>>>;
  generateUserCode: z.ZodOptional<z.ZodCustom<() => string | Promise<string>, () => string | Promise<string>>>;
  validateClient: z.ZodOptional<z.ZodCustom<(clientId: string) => boolean | Promise<boolean>, (clientId: string) => boolean | Promise<boolean>>>;
  onDeviceAuthRequest: z.ZodOptional<z.ZodCustom<(clientId: string, scope: string | undefined) => void | Promise<void>, (clientId: string, scope: string | undefined) => void | Promise<void>>>;
  verificationUri: z.ZodOptional<z.ZodString>;
  schema: z.ZodCustom<{
    deviceCode?: {
      modelName?: string | undefined;
      fields?: {
        deviceCode?: string | undefined;
        userCode?: string | undefined;
        userId?: string | undefined;
        expiresAt?: string | undefined;
        status?: string | undefined;
        lastPolledAt?: string | undefined;
        pollingInterval?: string | undefined;
        clientId?: string | undefined;
        scope?: string | undefined;
      } | undefined;
    } | undefined;
  }, {
    deviceCode?: {
      modelName?: string | undefined;
      fields?: {
        deviceCode?: string | undefined;
        userCode?: string | undefined;
        userId?: string | undefined;
        expiresAt?: string | undefined;
        status?: string | undefined;
        lastPolledAt?: string | undefined;
        pollingInterval?: string | undefined;
        clientId?: string | undefined;
        scope?: string | undefined;
      } | undefined;
    } | undefined;
  }>;
}, z.core.$strip>;
type DeviceAuthorizationOptions = z.infer<typeof deviceAuthorizationOptionsSchema>;
declare const deviceAuthorization: (options?: Partial<DeviceAuthorizationOptions>) => {
  id: "device-authorization";
  version: string;
  schema: {
    deviceCode: {
      fields: {
        deviceCode: {
          type: "string";
          required: true;
        };
        userCode: {
          type: "string";
          required: true;
        };
        userId: {
          type: "string";
          required: false;
        };
        expiresAt: {
          type: "date";
          required: true;
        };
        status: {
          type: "string";
          required: true;
        };
        lastPolledAt: {
          type: "date";
          required: false;
        };
        pollingInterval: {
          type: "number";
          required: false;
        };
        clientId: {
          type: "string";
          required: false;
        };
        scope: {
          type: "string";
          required: false;
        };
      };
    };
  };
  endpoints: {
    deviceCode: better_call0.StrictEndpoint<"/device/code", {
      method: "POST";
      body: z.ZodObject<{
        client_id: z.ZodString;
        scope: z.ZodOptional<z.ZodString>;
      }, z.core.$strip>;
      error: z.ZodObject<{
        error: z.ZodEnum<{
          invalid_request: "invalid_request";
          invalid_client: "invalid_client";
        }>;
        error_description: z.ZodString;
      }, z.core.$strip>;
      metadata: {
        openapi: {
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      device_code: {
                        type: string;
                        description: string;
                      };
                      user_code: {
                        type: string;
                        description: string;
                      };
                      verification_uri: {
                        type: string;
                        format: string;
                        description: string;
                      };
                      verification_uri_complete: {
                        type: string;
                        format: string;
                        description: string;
                      };
                      expires_in: {
                        type: string;
                        description: string;
                      };
                      interval: {
                        type: string;
                        description: string;
                      };
                    };
                  };
                };
              };
            };
            400: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      error: {
                        type: string;
                        enum: string[];
                      };
                      error_description: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete: string;
      expires_in: number;
      interval: number;
    }>;
    deviceToken: better_call0.StrictEndpoint<"/device/token", {
      method: "POST";
      body: z.ZodObject<{
        grant_type: z.ZodLiteral<"urn:ietf:params:oauth:grant-type:device_code">;
        device_code: z.ZodString;
        client_id: z.ZodString;
      }, z.core.$strip>;
      error: z.ZodObject<{
        error: z.ZodEnum<{
          invalid_request: "invalid_request";
          authorization_pending: "authorization_pending";
          slow_down: "slow_down";
          expired_token: "expired_token";
          access_denied: "access_denied";
          invalid_grant: "invalid_grant";
        }>;
        error_description: z.ZodString;
      }, z.core.$strip>;
      metadata: {
        openapi: {
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      session: {
                        $ref: string;
                      };
                      user: {
                        $ref: string;
                      };
                    };
                  };
                };
              };
            };
            400: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      error: {
                        type: string;
                        enum: string[];
                      };
                      error_description: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      access_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    }>;
    deviceVerify: better_call0.StrictEndpoint<"/device", {
      method: "GET";
      query: z.ZodObject<{
        user_code: z.ZodString;
      }, z.core.$strip>;
      error: z.ZodObject<{
        error: z.ZodEnum<{
          invalid_request: "invalid_request";
        }>;
        error_description: z.ZodString;
      }, z.core.$strip>;
      metadata: {
        openapi: {
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user_code: {
                        type: string;
                        description: string;
                      };
                      status: {
                        type: string;
                        enum: string[];
                        description: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      user_code: string;
      status: string;
    }>;
    deviceApprove: better_call0.StrictEndpoint<"/device/approve", {
      method: "POST";
      body: z.ZodObject<{
        userCode: z.ZodString;
      }, z.core.$strip>;
      error: z.ZodObject<{
        error: z.ZodEnum<{
          invalid_request: "invalid_request";
          expired_token: "expired_token";
          access_denied: "access_denied";
          device_code_already_processed: "device_code_already_processed";
          unauthorized: "unauthorized";
        }>;
        error_description: z.ZodString;
      }, z.core.$strip>;
      requireHeaders: true;
      metadata: {
        openapi: {
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      success: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      success: boolean;
    }>;
    deviceDeny: better_call0.StrictEndpoint<"/device/deny", {
      method: "POST";
      body: z.ZodObject<{
        userCode: z.ZodString;
      }, z.core.$strip>;
      error: z.ZodObject<{
        error: z.ZodEnum<{
          invalid_request: "invalid_request";
          expired_token: "expired_token";
          access_denied: "access_denied";
          unauthorized: "unauthorized";
        }>;
        error_description: z.ZodString;
      }, z.core.$strip>;
      requireHeaders: true;
      metadata: {
        openapi: {
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      success: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      success: boolean;
    }>;
  };
  $ERROR_CODES: {
    USER_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"USER_NOT_FOUND">;
    FAILED_TO_CREATE_SESSION: _better_auth_core_utils_error_codes0.RawError<"FAILED_TO_CREATE_SESSION">;
    INVALID_DEVICE_CODE: _better_auth_core_utils_error_codes0.RawError<"INVALID_DEVICE_CODE">;
    EXPIRED_DEVICE_CODE: _better_auth_core_utils_error_codes0.RawError<"EXPIRED_DEVICE_CODE">;
    EXPIRED_USER_CODE: _better_auth_core_utils_error_codes0.RawError<"EXPIRED_USER_CODE">;
    AUTHORIZATION_PENDING: _better_auth_core_utils_error_codes0.RawError<"AUTHORIZATION_PENDING">;
    ACCESS_DENIED: _better_auth_core_utils_error_codes0.RawError<"ACCESS_DENIED">;
    INVALID_USER_CODE: _better_auth_core_utils_error_codes0.RawError<"INVALID_USER_CODE">;
    DEVICE_CODE_ALREADY_PROCESSED: _better_auth_core_utils_error_codes0.RawError<"DEVICE_CODE_ALREADY_PROCESSED">;
    POLLING_TOO_FREQUENTLY: _better_auth_core_utils_error_codes0.RawError<"POLLING_TOO_FREQUENTLY">;
    INVALID_DEVICE_CODE_STATUS: _better_auth_core_utils_error_codes0.RawError<"INVALID_DEVICE_CODE_STATUS">;
    AUTHENTICATION_REQUIRED: _better_auth_core_utils_error_codes0.RawError<"AUTHENTICATION_REQUIRED">;
  };
  options: Partial<{
    expiresIn: TimeString;
    interval: TimeString;
    deviceCodeLength: number;
    userCodeLength: number;
    schema: {
      deviceCode?: {
        modelName?: string | undefined;
        fields?: {
          deviceCode?: string | undefined;
          userCode?: string | undefined;
          userId?: string | undefined;
          expiresAt?: string | undefined;
          status?: string | undefined;
          lastPolledAt?: string | undefined;
          pollingInterval?: string | undefined;
          clientId?: string | undefined;
          scope?: string | undefined;
        } | undefined;
      } | undefined;
    };
    generateDeviceCode?: (() => string | Promise<string>) | undefined;
    generateUserCode?: (() => string | Promise<string>) | undefined;
    validateClient?: ((clientId: string) => boolean | Promise<boolean>) | undefined;
    onDeviceAuthRequest?: ((clientId: string, scope: string | undefined) => void | Promise<void>) | undefined;
    verificationUri?: string | undefined;
  }>;
};
//#endregion
export { DeviceAuthorizationOptions, TimeString, deviceAuthorization, deviceAuthorizationOptionsSchema, ms, sec };