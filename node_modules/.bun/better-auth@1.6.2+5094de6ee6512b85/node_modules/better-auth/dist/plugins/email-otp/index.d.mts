import { EmailOTPOptions } from "./types.mjs";
import * as _better_auth_core0 from "@better-auth/core";
import * as _better_auth_core_db0 from "@better-auth/core/db";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";
import * as better_call0 from "better-call";
import * as zod from "zod";
import * as zod_v4_core0 from "zod/v4/core";

//#region src/plugins/email-otp/index.d.ts
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    "email-otp": {
      creator: typeof emailOTP;
    };
  }
}
declare const emailOTP: (options: EmailOTPOptions) => {
  id: "email-otp";
  version: string;
  init(ctx: _better_auth_core0.AuthContext): {
    options: {
      emailVerification: {
        sendVerificationEmail(data: {
          user: _better_auth_core_db0.User;
          url: string;
          token: string;
        }, request: Request | undefined): Promise<void>;
      };
    };
  } | undefined;
  endpoints: {
    sendVerificationOTP: better_call0.StrictEndpoint<"/email-otp/send-verification-otp", {
      method: "POST";
      body: zod.ZodObject<{
        email: zod.ZodString;
        type: zod.ZodEnum<{
          "sign-in": "sign-in";
          "change-email": "change-email";
          "email-verification": "email-verification";
          "forget-password": "forget-password";
        }>;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
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
    createVerificationOTP: better_call0.StrictEndpoint<string, {
      method: "POST";
      body: zod.ZodObject<{
        email: zod.ZodString;
        type: zod.ZodEnum<{
          "sign-in": "sign-in";
          "change-email": "change-email";
          "email-verification": "email-verification";
          "forget-password": "forget-password";
        }>;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "string";
                  };
                };
              };
            };
          };
        };
      };
    }, string>;
    getVerificationOTP: better_call0.StrictEndpoint<string, {
      method: "GET";
      query: zod.ZodObject<{
        email: zod.ZodString;
        type: zod.ZodEnum<{
          "sign-in": "sign-in";
          "change-email": "change-email";
          "email-verification": "email-verification";
          "forget-password": "forget-password";
        }>;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      otp: {
                        type: string;
                        nullable: boolean;
                        description: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      otp: null;
    } | {
      otp: string;
    }>;
    checkVerificationOTP: better_call0.StrictEndpoint<"/email-otp/check-verification-otp", {
      method: "POST";
      body: zod.ZodObject<{
        email: zod.ZodString;
        type: zod.ZodEnum<{
          "sign-in": "sign-in";
          "change-email": "change-email";
          "email-verification": "email-verification";
          "forget-password": "forget-password";
        }>;
        otp: zod.ZodString;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
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
    verifyEmailOTP: better_call0.StrictEndpoint<"/email-otp/verify-email", {
      method: "POST";
      body: zod.ZodObject<{
        email: zod.ZodString;
        otp: zod.ZodString;
      }, zod_v4_core0.$strip>;
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
                      status: {
                        type: string;
                        description: string;
                        enum: boolean[];
                      };
                      token: {
                        type: string;
                        nullable: boolean;
                        description: string;
                      };
                      user: {
                        $ref: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
      token: string;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any>;
    } | {
      status: boolean;
      token: null;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any>;
    }>;
    signInEmailOTP: better_call0.StrictEndpoint<"/sign-in/email-otp", {
      method: "POST";
      body: zod.ZodIntersection<zod.ZodObject<{
        email: zod.ZodString;
        otp: zod.ZodString;
        name: zod.ZodOptional<zod.ZodString>;
        image: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>, zod.ZodRecord<zod.ZodString, zod.ZodAny>>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
                        type: string;
                        description: string;
                      };
                      user: {
                        $ref: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      token: string;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    }>;
    requestPasswordResetEmailOTP: better_call0.StrictEndpoint<"/email-otp/request-password-reset", {
      method: "POST";
      body: zod.ZodObject<{
        email: zod.ZodString;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
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
      success: boolean;
    }>;
    forgetPasswordEmailOTP: better_call0.StrictEndpoint<"/forget-password/email-otp", {
      method: "POST";
      body: zod.ZodObject<{
        email: zod.ZodString;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
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
      success: boolean;
    }>;
    resetPasswordEmailOTP: better_call0.StrictEndpoint<"/email-otp/reset-password", {
      method: "POST";
      body: zod.ZodObject<{
        email: zod.ZodString;
        otp: zod.ZodString;
        password: zod.ZodString;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
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
    requestEmailChangeEmailOTP: better_call0.StrictEndpoint<"/email-otp/request-email-change", {
      method: "POST";
      body: zod.ZodObject<{
        newEmail: zod.ZodString;
        otp: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
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
    changeEmailEmailOTP: better_call0.StrictEndpoint<"/email-otp/change-email", {
      method: "POST";
      body: zod.ZodObject<{
        newEmail: zod.ZodString;
        otp: zod.ZodString;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
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
  hooks: {
    after: {
      matcher(context: _better_auth_core0.HookEndpointContext): boolean;
      handler: (inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>;
    }[];
  };
  rateLimit: ({
    pathMatcher(path: string): path is "/email-otp/send-verification-otp";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/email-otp/check-verification-otp";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/email-otp/verify-email";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/sign-in/email-otp";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/email-otp/request-password-reset";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/email-otp/reset-password";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/forget-password/email-otp";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/email-otp/request-email-change";
    window: number;
    max: number;
  } | {
    pathMatcher(path: string): path is "/email-otp/change-email";
    window: number;
    max: number;
  })[];
  options: EmailOTPOptions;
  $ERROR_CODES: {
    OTP_EXPIRED: _better_auth_core_utils_error_codes0.RawError<"OTP_EXPIRED">;
    INVALID_OTP: _better_auth_core_utils_error_codes0.RawError<"INVALID_OTP">;
    TOO_MANY_ATTEMPTS: _better_auth_core_utils_error_codes0.RawError<"TOO_MANY_ATTEMPTS">;
  };
};
//#endregion
export { type EmailOTPOptions, emailOTP };