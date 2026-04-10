import { OverrideMerge, Prettify as Prettify$1, UnionToIntersection } from "../types/helper.mjs";
import { AdditionalSessionFieldsInput, AdditionalUserFieldsInput } from "../types/models.mjs";
import { getIp } from "../utils/get-request-ip.mjs";
import { isAPIError } from "../utils/is-api-error.mjs";
import { requireOrgRole, requireResourceOwnership } from "./middlewares/authorization.mjs";
import { formCsrfMiddleware, originCheck, originCheckMiddleware } from "./middlewares/origin-check.mjs";
import { accountInfo, getAccessToken, linkSocialAccount, listUserAccounts, refreshToken, unlinkAccount } from "./routes/account.mjs";
import { callbackOAuth } from "./routes/callback.mjs";
import { createEmailVerificationToken, sendVerificationEmail, sendVerificationEmailFn, verifyEmail } from "./routes/email-verification.mjs";
import { error } from "./routes/error.mjs";
import { ok } from "./routes/ok.mjs";
import { requestPasswordReset, requestPasswordResetCallback, resetPassword, verifyPassword } from "./routes/password.mjs";
import { freshSessionMiddleware, getSession, getSessionFromCtx, listSessions, requestOnlySessionMiddleware, revokeOtherSessions, revokeSession, revokeSessions, sensitiveSessionMiddleware, sessionMiddleware } from "./routes/session.mjs";
import { signInEmail, signInSocial } from "./routes/sign-in.mjs";
import { signOut } from "./routes/sign-out.mjs";
import { signUpEmail } from "./routes/sign-up.mjs";
import { updateSession } from "./routes/update-session.mjs";
import { changeEmail, changePassword, deleteUser, deleteUserCallback, setPassword, updateUser } from "./routes/update-user.mjs";
import { getOAuthState } from "./state/oauth.mjs";
import { getShouldSkipSessionRefresh, setShouldSkipSessionRefresh } from "./state/should-session-refresh.mjs";
import { AuthContext, Awaitable, BetterAuthOptions, BetterAuthPlugin } from "@better-auth/core";
import * as _better_auth_core_db0 from "@better-auth/core/db";
import { InternalLogger } from "@better-auth/core/env";
import { APIError } from "@better-auth/core/error";
import * as _better_auth_core_oauth20 from "@better-auth/core/oauth2";
import * as better_call0 from "better-call";
import { AuthEndpoint, AuthMiddleware, createAuthEndpoint, createAuthMiddleware, optionsMiddleware } from "@better-auth/core/api";
import * as zod from "zod";
import * as zod_v4_core0 from "zod/v4/core";

//#region src/api/index.d.ts
declare function checkEndpointConflicts(options: BetterAuthOptions, logger: InternalLogger): void;
declare function getEndpoints<Option extends BetterAuthOptions>(ctx: Awaitable<AuthContext>, options: Option): {
  api: OverrideMerge<{
    readonly ok: better_call0.StrictEndpoint<"/ok", {
      method: "GET";
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      ok: {
                        type: string;
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
        scope: "server";
      };
    }, {
      ok: boolean;
    }>;
    readonly error: better_call0.StrictEndpoint<"/error", {
      method: "GET";
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "text/html": {
                  schema: {
                    type: "string";
                    description: string;
                  };
                };
              };
            };
          };
        };
        scope: "server";
      };
    }, Response>;
    readonly signInSocial: better_call0.StrictEndpoint<"/sign-in/social", {
      method: "POST";
      operationId: string;
      body: zod.ZodObject<{
        callbackURL: zod.ZodOptional<zod.ZodString>;
        newUserCallbackURL: zod.ZodOptional<zod.ZodString>;
        errorCallbackURL: zod.ZodOptional<zod.ZodString>;
        provider: zod.ZodType<(string & {}) | "linear" | "huggingface" | "github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat", unknown, zod_v4_core0.$ZodTypeInternals<(string & {}) | "linear" | "huggingface" | "github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat", unknown>>;
        disableRedirect: zod.ZodOptional<zod.ZodBoolean>;
        idToken: zod.ZodOptional<zod.ZodObject<{
          token: zod.ZodString;
          nonce: zod.ZodOptional<zod.ZodString>;
          accessToken: zod.ZodOptional<zod.ZodString>;
          refreshToken: zod.ZodOptional<zod.ZodString>;
          expiresAt: zod.ZodOptional<zod.ZodNumber>;
          user: zod.ZodOptional<zod.ZodObject<{
            name: zod.ZodOptional<zod.ZodObject<{
              firstName: zod.ZodOptional<zod.ZodString>;
              lastName: zod.ZodOptional<zod.ZodString>;
            }, zod_v4_core0.$strip>>;
            email: zod.ZodOptional<zod.ZodString>;
          }, zod_v4_core0.$strip>>;
        }, zod_v4_core0.$strip>>;
        scopes: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
        requestSignUp: zod.ZodOptional<zod.ZodBoolean>;
        loginHint: zod.ZodOptional<zod.ZodString>;
        additionalData: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodAny>>;
      }, zod_v4_core0.$strip>;
      metadata: {
        $Infer: {
          body: zod.infer<zod.ZodObject<{
            callbackURL: zod.ZodOptional<zod.ZodString>;
            newUserCallbackURL: zod.ZodOptional<zod.ZodString>;
            errorCallbackURL: zod.ZodOptional<zod.ZodString>;
            provider: zod.ZodType<(string & {}) | "linear" | "huggingface" | "github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat", unknown, zod_v4_core0.$ZodTypeInternals<(string & {}) | "linear" | "huggingface" | "github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat", unknown>>;
            disableRedirect: zod.ZodOptional<zod.ZodBoolean>;
            idToken: zod.ZodOptional<zod.ZodObject<{
              token: zod.ZodString;
              nonce: zod.ZodOptional<zod.ZodString>;
              accessToken: zod.ZodOptional<zod.ZodString>;
              refreshToken: zod.ZodOptional<zod.ZodString>;
              expiresAt: zod.ZodOptional<zod.ZodNumber>;
              user: zod.ZodOptional<zod.ZodObject<{
                name: zod.ZodOptional<zod.ZodObject<{
                  firstName: zod.ZodOptional<zod.ZodString>;
                  lastName: zod.ZodOptional<zod.ZodString>;
                }, zod_v4_core0.$strip>>;
                email: zod.ZodOptional<zod.ZodString>;
              }, zod_v4_core0.$strip>>;
            }, zod_v4_core0.$strip>>;
            scopes: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
            requestSignUp: zod.ZodOptional<zod.ZodBoolean>;
            loginHint: zod.ZodOptional<zod.ZodString>;
            additionalData: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodAny>>;
          }, zod_v4_core0.$strip>>;
          returned: {
            redirect: boolean;
            token?: string | undefined;
            url?: string | undefined;
            user?: ({
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T ? { [K in keyof T]: T[K] } : never) | undefined;
          };
        };
        openapi: {
          description: string;
          operationId: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    description: string;
                    properties: {
                      token: {
                        type: string;
                      };
                      user: {
                        type: string;
                        $ref: string;
                      };
                      url: {
                        type: string;
                      };
                      redirect: {
                        type: string;
                        enum: boolean[];
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
      redirect: boolean;
      url: string;
    } | {
      redirect: boolean;
      token: string;
      url: undefined;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_1 ? { [K in keyof T_1]: T_1[K] } : never;
    }>;
    readonly callbackOAuth: better_call0.StrictEndpoint<"/callback/:id", {
      method: ("GET" | "POST")[];
      operationId: string;
      body: zod.ZodOptional<zod.ZodObject<{
        code: zod.ZodOptional<zod.ZodString>;
        error: zod.ZodOptional<zod.ZodString>;
        device_id: zod.ZodOptional<zod.ZodString>;
        error_description: zod.ZodOptional<zod.ZodString>;
        state: zod.ZodOptional<zod.ZodString>;
        user: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>>;
      query: zod.ZodOptional<zod.ZodObject<{
        code: zod.ZodOptional<zod.ZodString>;
        error: zod.ZodOptional<zod.ZodString>;
        device_id: zod.ZodOptional<zod.ZodString>;
        error_description: zod.ZodOptional<zod.ZodString>;
        state: zod.ZodOptional<zod.ZodString>;
        user: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>>;
      metadata: {
        allowedMediaTypes: string[];
        scope: "server";
      };
    }, void>;
    readonly getSession: better_call0.StrictEndpoint<"/get-session", {
      method: ("GET" | "POST")[];
      operationId: string;
      query: zod.ZodOptional<zod.ZodObject<{
        disableCookieCache: zod.ZodOptional<zod.ZodCoercedBoolean<unknown>>;
        disableRefresh: zod.ZodOptional<zod.ZodCoercedBoolean<unknown>>;
      }, zod_v4_core0.$strip>>;
      requireHeaders: true;
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
                    nullable: boolean;
                    properties: {
                      session: {
                        $ref: string;
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
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["session"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"session", Option["plugins"]> extends infer T_2 ? { [K_1 in keyof T_2]: T_2[K_1] } : never;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_3 ? { [K in keyof T_3]: T_3[K] } : never;
    } | null>;
    readonly signOut: better_call0.StrictEndpoint<"/sign-out", {
      method: "POST";
      operationId: string;
      requireHeaders: true;
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
    readonly signUpEmail: better_call0.StrictEndpoint<"/sign-up/email", {
      method: "POST";
      operationId: string;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
      body: zod.ZodIntersection<zod.ZodObject<{
        name: zod.ZodString;
        email: zod.ZodEmail;
        password: zod.ZodString;
        image: zod.ZodOptional<zod.ZodString>;
        callbackURL: zod.ZodOptional<zod.ZodString>;
        rememberMe: zod.ZodOptional<zod.ZodBoolean>;
      }, zod_v4_core0.$strip>, zod.ZodRecord<zod.ZodString, zod.ZodAny>>;
      metadata: {
        allowedMediaTypes: string[];
        $Infer: {
          body: {
            name: string;
            email: string;
            password: string;
            image?: string | undefined;
            callbackURL?: string | undefined;
            rememberMe?: boolean | undefined;
          } & _better_auth_core_db0.InferDBFieldsFromPluginsInput<"user", Option["plugins"]> & _better_auth_core_db0.InferDBFieldsFromOptionsInput<Option["user"]>;
          returned: {
            token: string | null;
            user: {
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_4 ? { [K in keyof T_4]: T_4[K] } : never;
          };
        };
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    name: {
                      type: string;
                      description: string;
                    };
                    email: {
                      type: string;
                      description: string;
                    };
                    password: {
                      type: string;
                      description: string;
                    };
                    image: {
                      type: string;
                      description: string;
                    };
                    callbackURL: {
                      type: string;
                      description: string;
                    };
                    rememberMe: {
                      type: string;
                      description: string;
                    };
                  };
                  required: string[];
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
                        type: string;
                        nullable: boolean;
                        description: string;
                      };
                      user: {
                        type: string;
                        properties: {
                          id: {
                            type: string;
                            description: string;
                          };
                          email: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          name: {
                            type: string;
                            description: string;
                          };
                          image: {
                            type: string;
                            format: string;
                            nullable: boolean;
                            description: string;
                          };
                          emailVerified: {
                            type: string;
                            description: string;
                          };
                          createdAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          updatedAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                        };
                        required: string[];
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
            "422": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      message: {
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
      token: null;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_5 ? { [K in keyof T_5]: T_5[K] } : never;
    } | {
      token: string;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_6 ? { [K in keyof T_6]: T_6[K] } : never;
    }>;
    readonly signInEmail: better_call0.StrictEndpoint<"/sign-in/email", {
      method: "POST";
      operationId: string;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
      body: zod.ZodObject<{
        email: zod.ZodString;
        password: zod.ZodString;
        callbackURL: zod.ZodOptional<zod.ZodString>;
        rememberMe: zod.ZodOptional<zod.ZodDefault<zod.ZodBoolean>>;
      }, zod_v4_core0.$strip>;
      metadata: {
        allowedMediaTypes: string[];
        $Infer: {
          body: {
            email: string;
            password: string;
            callbackURL?: string | undefined;
            rememberMe?: boolean | undefined;
          };
          returned: {
            redirect: boolean;
            token: string;
            url?: string | undefined;
            user: {
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_7 ? { [K in keyof T_7]: T_7[K] } : never;
          };
        };
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
                    description: string;
                    properties: {
                      redirect: {
                        type: string;
                        enum: boolean[];
                      };
                      token: {
                        type: string;
                        description: string;
                      };
                      url: {
                        type: string;
                        nullable: boolean;
                      };
                      user: {
                        type: string;
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
      redirect: boolean;
      token: string;
      url?: string | undefined;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_8 ? { [K in keyof T_8]: T_8[K] } : never;
    }>;
    readonly resetPassword: better_call0.StrictEndpoint<"/reset-password", {
      method: "POST";
      operationId: string;
      query: zod.ZodOptional<zod.ZodObject<{
        token: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>>;
      body: zod.ZodObject<{
        newPassword: zod.ZodString;
        token: zod.ZodOptional<zod.ZodString>;
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
                      status: {
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
      status: boolean;
    }>;
    readonly verifyPassword: better_call0.StrictEndpoint<"/verify-password", {
      method: "POST";
      body: zod.ZodObject<{
        password: zod.ZodString;
      }, zod_v4_core0.$strip>;
      metadata: {
        scope: "server";
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
                      status: {
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
    }, {
      status: boolean;
    }>;
    readonly verifyEmail: better_call0.StrictEndpoint<"/verify-email", {
      method: "GET";
      operationId: string;
      query: zod.ZodObject<{
        token: zod.ZodString;
        callbackURL: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
      metadata: {
        openapi: {
          description: string;
          parameters: ({
            name: string;
            in: "query";
            description: string;
            required: true;
            schema: {
              type: "string";
            };
          } | {
            name: string;
            in: "query";
            description: string;
            required: false;
            schema: {
              type: "string";
            };
          })[];
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        $ref: string;
                      };
                      status: {
                        type: string;
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
    }, void | {
      status: boolean;
    }>;
    readonly sendVerificationEmail: better_call0.StrictEndpoint<"/send-verification-email", {
      method: "POST";
      operationId: string;
      body: zod.ZodObject<{
        email: zod.ZodEmail;
        callbackURL: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    email: {
                      type: string;
                      description: string;
                      example: string;
                    };
                    callbackURL: {
                      type: string;
                      description: string;
                      example: string;
                      nullable: boolean;
                    };
                  };
                  required: string[];
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                        description: string;
                        example: boolean;
                      };
                    };
                  };
                };
              };
            };
            "400": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      message: {
                        type: string;
                        description: string;
                        example: string;
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
      status: boolean;
    }>;
    readonly changeEmail: better_call0.StrictEndpoint<"/change-email", {
      method: "POST";
      body: zod.ZodObject<{
        newEmail: zod.ZodEmail;
        callbackURL: zod.ZodOptional<zod.ZodString>;
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
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        $ref: string;
                      };
                      status: {
                        type: string;
                        description: string;
                      };
                      message: {
                        type: string;
                        enum: string[];
                        description: string;
                        nullable: boolean;
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
    }>;
    readonly changePassword: better_call0.StrictEndpoint<"/change-password", {
      method: "POST";
      operationId: string;
      body: zod.ZodObject<{
        newPassword: zod.ZodString;
        currentPassword: zod.ZodString;
        revokeOtherSessions: zod.ZodOptional<zod.ZodBoolean>;
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
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
                        type: string;
                        nullable: boolean;
                        description: string;
                      };
                      user: {
                        type: string;
                        properties: {
                          id: {
                            type: string;
                            description: string;
                          };
                          email: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          name: {
                            type: string;
                            description: string;
                          };
                          image: {
                            type: string;
                            format: string;
                            nullable: boolean;
                            description: string;
                          };
                          emailVerified: {
                            type: string;
                            description: string;
                          };
                          createdAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          updatedAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                        };
                        required: string[];
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
      token: string | null;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any> & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    }>;
    readonly setPassword: better_call0.StrictEndpoint<string, {
      method: "POST";
      body: zod.ZodObject<{
        newPassword: zod.ZodString;
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
    }, {
      status: boolean;
    }>;
    readonly updateSession: better_call0.StrictEndpoint<"/update-session", {
      method: "POST";
      operationId: string;
      body: zod.ZodRecord<zod.ZodString, zod.ZodAny>;
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
        $Infer: {
          body: Partial<AdditionalSessionFieldsInput<Option>>;
        };
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
                      session: {
                        type: string;
                        $ref: string;
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
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      };
    }>;
    readonly updateUser: better_call0.StrictEndpoint<"/update-user", {
      method: "POST";
      operationId: string;
      body: zod.ZodRecord<zod.ZodString, zod.ZodAny>;
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
        $Infer: {
          body: Partial<AdditionalUserFieldsInput<Option>> & {
            name?: string | undefined;
            image?: string | undefined | null;
          };
        };
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    name: {
                      type: string;
                      description: string;
                    };
                    image: {
                      type: string;
                      description: string;
                      nullable: boolean;
                    };
                  };
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        $ref: string;
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
      status: boolean;
    }>;
    readonly deleteUser: better_call0.StrictEndpoint<"/delete-user", {
      method: "POST";
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
      body: zod.ZodObject<{
        callbackURL: zod.ZodOptional<zod.ZodString>;
        password: zod.ZodOptional<zod.ZodString>;
        token: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    callbackURL: {
                      type: string;
                      description: string;
                    };
                    password: {
                      type: string;
                      description: string;
                    };
                    token: {
                      type: string;
                      description: string;
                    };
                  };
                };
              };
            };
          };
          responses: {
            "200": {
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
                      message: {
                        type: string;
                        enum: string[];
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
      success: boolean;
      message: string;
    }>;
    readonly requestPasswordReset: better_call0.StrictEndpoint<"/request-password-reset", {
      method: "POST";
      body: zod.ZodObject<{
        email: zod.ZodEmail;
        redirectTo: zod.ZodOptional<zod.ZodString>;
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
                      status: {
                        type: string;
                      };
                      message: {
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
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
    }, {
      status: boolean;
      message: string;
    }>;
    readonly requestPasswordResetCallback: better_call0.StrictEndpoint<"/reset-password/:token", {
      method: "GET";
      operationId: string;
      query: zod.ZodObject<{
        callbackURL: zod.ZodString;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          parameters: ({
            name: string;
            in: "path";
            required: true;
            description: string;
            schema: {
              type: "string";
            };
          } | {
            name: string;
            in: "query";
            required: true;
            description: string;
            schema: {
              type: "string";
            };
          })[];
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
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
    }, never>;
    readonly listSessions: better_call0.StrictEndpoint<"/list-sessions", {
      method: "GET";
      operationId: string;
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
      requireHeaders: true;
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
                    type: "array";
                    items: {
                      $ref: string;
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, Prettify$1<{
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      expiresAt: Date;
      token: string;
      ipAddress?: string | null | undefined;
      userAgent?: string | null | undefined;
    } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["session"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"session", Option["plugins"]> extends infer T_9 ? { [K_1 in keyof T_9]: T_9[K_1] } : never>[]>;
    readonly revokeSession: better_call0.StrictEndpoint<"/revoke-session", {
      method: "POST";
      body: zod.ZodObject<{
        token: zod.ZodString;
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
      requireHeaders: true;
      metadata: {
        openapi: {
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    token: {
                      type: string;
                      description: string;
                    };
                  };
                  required: string[];
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
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
      status: boolean;
    }>;
    readonly revokeSessions: better_call0.StrictEndpoint<"/revoke-sessions", {
      method: "POST";
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
      requireHeaders: true;
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
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
      status: boolean;
    }>;
    readonly revokeOtherSessions: better_call0.StrictEndpoint<"/revoke-other-sessions", {
      method: "POST";
      requireHeaders: true;
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
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
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
      status: boolean;
    }>;
    readonly linkSocialAccount: better_call0.StrictEndpoint<"/link-social", {
      method: "POST";
      requireHeaders: true;
      body: zod.ZodObject<{
        callbackURL: zod.ZodOptional<zod.ZodString>;
        provider: zod.ZodType<(string & {}) | "linear" | "huggingface" | "github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat", unknown, zod_v4_core0.$ZodTypeInternals<(string & {}) | "linear" | "huggingface" | "github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat", unknown>>;
        idToken: zod.ZodOptional<zod.ZodObject<{
          token: zod.ZodString;
          nonce: zod.ZodOptional<zod.ZodString>;
          accessToken: zod.ZodOptional<zod.ZodString>;
          refreshToken: zod.ZodOptional<zod.ZodString>;
          scopes: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
        }, zod_v4_core0.$strip>>;
        requestSignUp: zod.ZodOptional<zod.ZodBoolean>;
        scopes: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
        errorCallbackURL: zod.ZodOptional<zod.ZodString>;
        disableRedirect: zod.ZodOptional<zod.ZodBoolean>;
        additionalData: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodAny>>;
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
          description: string;
          operationId: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      url: {
                        type: string;
                        description: string;
                      };
                      redirect: {
                        type: string;
                        description: string;
                      };
                      status: {
                        type: string;
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
      url: string;
      redirect: boolean;
    }>;
    readonly listUserAccounts: better_call0.StrictEndpoint<"/list-accounts", {
      method: "GET";
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
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "array";
                    items: {
                      type: string;
                      properties: {
                        id: {
                          type: string;
                        };
                        providerId: {
                          type: string;
                        };
                        createdAt: {
                          type: string;
                          format: string;
                        };
                        updatedAt: {
                          type: string;
                          format: string;
                        };
                        accountId: {
                          type: string;
                        };
                        userId: {
                          type: string;
                        };
                        scopes: {
                          type: string;
                          items: {
                            type: string;
                          };
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
      };
    }, {
      scopes: string[];
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      providerId: string;
      accountId: string;
    }[]>;
    readonly deleteUserCallback: better_call0.StrictEndpoint<"/delete-user/callback", {
      method: "GET";
      query: zod.ZodObject<{
        token: zod.ZodString;
        callbackURL: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
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
                      message: {
                        type: string;
                        enum: string[];
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
      success: boolean;
      message: string;
    }>;
    readonly unlinkAccount: better_call0.StrictEndpoint<"/unlink-account", {
      method: "POST";
      body: zod.ZodObject<{
        providerId: zod.ZodString;
        accountId: zod.ZodOptional<zod.ZodString>;
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
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
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
      status: boolean;
    }>;
    readonly refreshToken: better_call0.StrictEndpoint<"/refresh-token", {
      method: "POST";
      body: zod.ZodObject<{
        providerId: zod.ZodString;
        accountId: zod.ZodOptional<zod.ZodString>;
        userId: zod.ZodOptional<zod.ZodString>;
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
                      tokenType: {
                        type: string;
                      };
                      idToken: {
                        type: string;
                      };
                      accessToken: {
                        type: string;
                      };
                      refreshToken: {
                        type: string;
                      };
                      accessTokenExpiresAt: {
                        type: string;
                        format: string;
                      };
                      refreshTokenExpiresAt: {
                        type: string;
                        format: string;
                      };
                    };
                  };
                };
              };
            };
            400: {
              description: string;
            };
          };
        };
      };
    }, {
      accessToken: string | undefined;
      refreshToken: string;
      accessTokenExpiresAt: Date | undefined;
      refreshTokenExpiresAt: Date | null | undefined;
      scope: string | null | undefined;
      idToken: string | null | undefined;
      providerId: string;
      accountId: string;
    }>;
    readonly getAccessToken: better_call0.StrictEndpoint<"/get-access-token", {
      method: "POST";
      body: zod.ZodObject<{
        providerId: zod.ZodString;
        accountId: zod.ZodOptional<zod.ZodString>;
        userId: zod.ZodOptional<zod.ZodString>;
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
                      tokenType: {
                        type: string;
                      };
                      idToken: {
                        type: string;
                      };
                      accessToken: {
                        type: string;
                      };
                      accessTokenExpiresAt: {
                        type: string;
                        format: string;
                      };
                    };
                  };
                };
              };
            };
            400: {
              description: string;
            };
          };
        };
      };
    }, {
      accessToken: string;
      accessTokenExpiresAt: Date | undefined;
      scopes: string[];
      idToken: string | undefined;
    }>;
    readonly accountInfo: better_call0.StrictEndpoint<"/account-info", {
      method: "GET";
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
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        properties: {
                          id: {
                            type: string;
                          };
                          name: {
                            type: string;
                          };
                          email: {
                            type: string;
                          };
                          image: {
                            type: string;
                          };
                          emailVerified: {
                            type: string;
                          };
                        };
                        required: string[];
                      };
                      data: {
                        type: string;
                        properties: {};
                        additionalProperties: boolean;
                      };
                    };
                    required: string[];
                    additionalProperties: boolean;
                  };
                };
              };
            };
          };
        };
      };
      query: zod.ZodOptional<zod.ZodObject<{
        accountId: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>>;
    }, {
      user: _better_auth_core_oauth20.OAuth2UserInfo;
      data: Record<string, any>;
    } | null>;
  }, UnionToIntersection<Option["plugins"] extends (infer T_10)[] ? T_10 extends BetterAuthPlugin ? T_10 extends {
    endpoints: infer E;
  } ? E : {} : {} : {}>>;
  middlewares: {
    path: string;
    middleware: any;
  }[];
};
declare const router: <Option extends BetterAuthOptions>(ctx: AuthContext, options: Option) => {
  handler: (request: Request) => Promise<Response>;
  endpoints: UnionToIntersection<Option["plugins"] extends (infer T)[] ? T extends BetterAuthPlugin ? T extends {
    endpoints: infer E;
  } ? E : {} : {} : {}> extends infer T_1 ? T_1 extends UnionToIntersection<Option["plugins"] extends (infer T)[] ? T extends BetterAuthPlugin ? T extends {
    endpoints: infer E;
  } ? E : {} : {} : {}> ? T_1 extends unknown ? Prettify$1<({
    readonly ok: better_call0.StrictEndpoint<"/ok", {
      method: "GET";
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      ok: {
                        type: string;
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
        scope: "server";
      };
    }, {
      ok: boolean;
    }>;
    readonly error: better_call0.StrictEndpoint<"/error", {
      method: "GET";
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "text/html": {
                  schema: {
                    type: "string";
                    description: string;
                  };
                };
              };
            };
          };
        };
        scope: "server";
      };
    }, Response>;
    readonly signInSocial: better_call0.StrictEndpoint<"/sign-in/social", {
      method: "POST";
      operationId: string;
      body: zod.ZodObject<{
        callbackURL: zod.ZodOptional<zod.ZodString>;
        newUserCallbackURL: zod.ZodOptional<zod.ZodString>;
        errorCallbackURL: zod.ZodOptional<zod.ZodString>;
        provider: zod.ZodType<(string & {}) | "linear" | "huggingface" | "github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat", unknown, zod_v4_core0.$ZodTypeInternals<(string & {}) | "linear" | "huggingface" | "github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat", unknown>>;
        disableRedirect: zod.ZodOptional<zod.ZodBoolean>;
        idToken: zod.ZodOptional<zod.ZodObject<{
          token: zod.ZodString;
          nonce: zod.ZodOptional<zod.ZodString>;
          accessToken: zod.ZodOptional<zod.ZodString>;
          refreshToken: zod.ZodOptional<zod.ZodString>;
          expiresAt: zod.ZodOptional<zod.ZodNumber>;
          user: zod.ZodOptional<zod.ZodObject<{
            name: zod.ZodOptional<zod.ZodObject<{
              firstName: zod.ZodOptional<zod.ZodString>;
              lastName: zod.ZodOptional<zod.ZodString>;
            }, zod_v4_core0.$strip>>;
            email: zod.ZodOptional<zod.ZodString>;
          }, zod_v4_core0.$strip>>;
        }, zod_v4_core0.$strip>>;
        scopes: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
        requestSignUp: zod.ZodOptional<zod.ZodBoolean>;
        loginHint: zod.ZodOptional<zod.ZodString>;
        additionalData: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodAny>>;
      }, zod_v4_core0.$strip>;
      metadata: {
        $Infer: {
          body: zod.infer<zod.ZodObject<{
            callbackURL: zod.ZodOptional<zod.ZodString>;
            newUserCallbackURL: zod.ZodOptional<zod.ZodString>;
            errorCallbackURL: zod.ZodOptional<zod.ZodString>;
            provider: zod.ZodType<(string & {}) | "linear" | "huggingface" | "github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat", unknown, zod_v4_core0.$ZodTypeInternals<(string & {}) | "linear" | "huggingface" | "github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat", unknown>>;
            disableRedirect: zod.ZodOptional<zod.ZodBoolean>;
            idToken: zod.ZodOptional<zod.ZodObject<{
              token: zod.ZodString;
              nonce: zod.ZodOptional<zod.ZodString>;
              accessToken: zod.ZodOptional<zod.ZodString>;
              refreshToken: zod.ZodOptional<zod.ZodString>;
              expiresAt: zod.ZodOptional<zod.ZodNumber>;
              user: zod.ZodOptional<zod.ZodObject<{
                name: zod.ZodOptional<zod.ZodObject<{
                  firstName: zod.ZodOptional<zod.ZodString>;
                  lastName: zod.ZodOptional<zod.ZodString>;
                }, zod_v4_core0.$strip>>;
                email: zod.ZodOptional<zod.ZodString>;
              }, zod_v4_core0.$strip>>;
            }, zod_v4_core0.$strip>>;
            scopes: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
            requestSignUp: zod.ZodOptional<zod.ZodBoolean>;
            loginHint: zod.ZodOptional<zod.ZodString>;
            additionalData: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodAny>>;
          }, zod_v4_core0.$strip>>;
          returned: {
            redirect: boolean;
            token?: string | undefined;
            url?: string | undefined;
            user?: ({
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_3 ? { [K_1 in keyof T_3]: T_3[K_1] } : never) | undefined;
          };
        };
        openapi: {
          description: string;
          operationId: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    description: string;
                    properties: {
                      token: {
                        type: string;
                      };
                      user: {
                        type: string;
                        $ref: string;
                      };
                      url: {
                        type: string;
                      };
                      redirect: {
                        type: string;
                        enum: boolean[];
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
      redirect: boolean;
      url: string;
    } | {
      redirect: boolean;
      token: string;
      url: undefined;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_4 ? { [K_1 in keyof T_4]: T_4[K_1] } : never;
    }>;
    readonly callbackOAuth: better_call0.StrictEndpoint<"/callback/:id", {
      method: ("GET" | "POST")[];
      operationId: string;
      body: zod.ZodOptional<zod.ZodObject<{
        code: zod.ZodOptional<zod.ZodString>;
        error: zod.ZodOptional<zod.ZodString>;
        device_id: zod.ZodOptional<zod.ZodString>;
        error_description: zod.ZodOptional<zod.ZodString>;
        state: zod.ZodOptional<zod.ZodString>;
        user: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>>;
      query: zod.ZodOptional<zod.ZodObject<{
        code: zod.ZodOptional<zod.ZodString>;
        error: zod.ZodOptional<zod.ZodString>;
        device_id: zod.ZodOptional<zod.ZodString>;
        error_description: zod.ZodOptional<zod.ZodString>;
        state: zod.ZodOptional<zod.ZodString>;
        user: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>>;
      metadata: {
        allowedMediaTypes: string[];
        scope: "server";
      };
    }, void>;
    readonly getSession: better_call0.StrictEndpoint<"/get-session", {
      method: ("GET" | "POST")[];
      operationId: string;
      query: zod.ZodOptional<zod.ZodObject<{
        disableCookieCache: zod.ZodOptional<zod.ZodCoercedBoolean<unknown>>;
        disableRefresh: zod.ZodOptional<zod.ZodCoercedBoolean<unknown>>;
      }, zod_v4_core0.$strip>>;
      requireHeaders: true;
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
                    nullable: boolean;
                    properties: {
                      session: {
                        $ref: string;
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
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["session"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"session", Option["plugins"]> extends infer T_5 ? { [K_2 in keyof T_5]: T_5[K_2] } : never;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_6 ? { [K_1 in keyof T_6]: T_6[K_1] } : never;
    } | null>;
    readonly signOut: better_call0.StrictEndpoint<"/sign-out", {
      method: "POST";
      operationId: string;
      requireHeaders: true;
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
    readonly signUpEmail: better_call0.StrictEndpoint<"/sign-up/email", {
      method: "POST";
      operationId: string;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
      body: zod.ZodIntersection<zod.ZodObject<{
        name: zod.ZodString;
        email: zod.ZodEmail;
        password: zod.ZodString;
        image: zod.ZodOptional<zod.ZodString>;
        callbackURL: zod.ZodOptional<zod.ZodString>;
        rememberMe: zod.ZodOptional<zod.ZodBoolean>;
      }, zod_v4_core0.$strip>, zod.ZodRecord<zod.ZodString, zod.ZodAny>>;
      metadata: {
        allowedMediaTypes: string[];
        $Infer: {
          body: {
            name: string;
            email: string;
            password: string;
            image?: string | undefined;
            callbackURL?: string | undefined;
            rememberMe?: boolean | undefined;
          } & _better_auth_core_db0.InferDBFieldsFromPluginsInput<"user", Option["plugins"]> & _better_auth_core_db0.InferDBFieldsFromOptionsInput<Option["user"]>;
          returned: {
            token: string | null;
            user: {
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_7 ? { [K_1 in keyof T_7]: T_7[K_1] } : never;
          };
        };
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    name: {
                      type: string;
                      description: string;
                    };
                    email: {
                      type: string;
                      description: string;
                    };
                    password: {
                      type: string;
                      description: string;
                    };
                    image: {
                      type: string;
                      description: string;
                    };
                    callbackURL: {
                      type: string;
                      description: string;
                    };
                    rememberMe: {
                      type: string;
                      description: string;
                    };
                  };
                  required: string[];
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
                        type: string;
                        nullable: boolean;
                        description: string;
                      };
                      user: {
                        type: string;
                        properties: {
                          id: {
                            type: string;
                            description: string;
                          };
                          email: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          name: {
                            type: string;
                            description: string;
                          };
                          image: {
                            type: string;
                            format: string;
                            nullable: boolean;
                            description: string;
                          };
                          emailVerified: {
                            type: string;
                            description: string;
                          };
                          createdAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          updatedAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                        };
                        required: string[];
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
            "422": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      message: {
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
      token: null;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_8 ? { [K_1 in keyof T_8]: T_8[K_1] } : never;
    } | {
      token: string;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_9 ? { [K_1 in keyof T_9]: T_9[K_1] } : never;
    }>;
    readonly signInEmail: better_call0.StrictEndpoint<"/sign-in/email", {
      method: "POST";
      operationId: string;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
      body: zod.ZodObject<{
        email: zod.ZodString;
        password: zod.ZodString;
        callbackURL: zod.ZodOptional<zod.ZodString>;
        rememberMe: zod.ZodOptional<zod.ZodDefault<zod.ZodBoolean>>;
      }, zod_v4_core0.$strip>;
      metadata: {
        allowedMediaTypes: string[];
        $Infer: {
          body: {
            email: string;
            password: string;
            callbackURL?: string | undefined;
            rememberMe?: boolean | undefined;
          };
          returned: {
            redirect: boolean;
            token: string;
            url?: string | undefined;
            user: {
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_10 ? { [K_1 in keyof T_10]: T_10[K_1] } : never;
          };
        };
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
                    description: string;
                    properties: {
                      redirect: {
                        type: string;
                        enum: boolean[];
                      };
                      token: {
                        type: string;
                        description: string;
                      };
                      url: {
                        type: string;
                        nullable: boolean;
                      };
                      user: {
                        type: string;
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
      redirect: boolean;
      token: string;
      url?: string | undefined;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["user"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"user", Option["plugins"]> extends infer T_11 ? { [K_1 in keyof T_11]: T_11[K_1] } : never;
    }>;
    readonly resetPassword: better_call0.StrictEndpoint<"/reset-password", {
      method: "POST";
      operationId: string;
      query: zod.ZodOptional<zod.ZodObject<{
        token: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>>;
      body: zod.ZodObject<{
        newPassword: zod.ZodString;
        token: zod.ZodOptional<zod.ZodString>;
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
                      status: {
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
      status: boolean;
    }>;
    readonly verifyPassword: better_call0.StrictEndpoint<"/verify-password", {
      method: "POST";
      body: zod.ZodObject<{
        password: zod.ZodString;
      }, zod_v4_core0.$strip>;
      metadata: {
        scope: "server";
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
                      status: {
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
    }, {
      status: boolean;
    }>;
    readonly verifyEmail: better_call0.StrictEndpoint<"/verify-email", {
      method: "GET";
      operationId: string;
      query: zod.ZodObject<{
        token: zod.ZodString;
        callbackURL: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
      metadata: {
        openapi: {
          description: string;
          parameters: ({
            name: string;
            in: "query";
            description: string;
            required: true;
            schema: {
              type: "string";
            };
          } | {
            name: string;
            in: "query";
            description: string;
            required: false;
            schema: {
              type: "string";
            };
          })[];
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        $ref: string;
                      };
                      status: {
                        type: string;
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
    }, void | {
      status: boolean;
    }>;
    readonly sendVerificationEmail: better_call0.StrictEndpoint<"/send-verification-email", {
      method: "POST";
      operationId: string;
      body: zod.ZodObject<{
        email: zod.ZodEmail;
        callbackURL: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    email: {
                      type: string;
                      description: string;
                      example: string;
                    };
                    callbackURL: {
                      type: string;
                      description: string;
                      example: string;
                      nullable: boolean;
                    };
                  };
                  required: string[];
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                        description: string;
                        example: boolean;
                      };
                    };
                  };
                };
              };
            };
            "400": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      message: {
                        type: string;
                        description: string;
                        example: string;
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
      status: boolean;
    }>;
    readonly changeEmail: better_call0.StrictEndpoint<"/change-email", {
      method: "POST";
      body: zod.ZodObject<{
        newEmail: zod.ZodEmail;
        callbackURL: zod.ZodOptional<zod.ZodString>;
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
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        $ref: string;
                      };
                      status: {
                        type: string;
                        description: string;
                      };
                      message: {
                        type: string;
                        enum: string[];
                        description: string;
                        nullable: boolean;
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
    }>;
    readonly changePassword: better_call0.StrictEndpoint<"/change-password", {
      method: "POST";
      operationId: string;
      body: zod.ZodObject<{
        newPassword: zod.ZodString;
        currentPassword: zod.ZodString;
        revokeOtherSessions: zod.ZodOptional<zod.ZodBoolean>;
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
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
                        type: string;
                        nullable: boolean;
                        description: string;
                      };
                      user: {
                        type: string;
                        properties: {
                          id: {
                            type: string;
                            description: string;
                          };
                          email: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          name: {
                            type: string;
                            description: string;
                          };
                          image: {
                            type: string;
                            format: string;
                            nullable: boolean;
                            description: string;
                          };
                          emailVerified: {
                            type: string;
                            description: string;
                          };
                          createdAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                          updatedAt: {
                            type: string;
                            format: string;
                            description: string;
                          };
                        };
                        required: string[];
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
      token: string | null;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any> & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    }>;
    readonly setPassword: better_call0.StrictEndpoint<string, {
      method: "POST";
      body: zod.ZodObject<{
        newPassword: zod.ZodString;
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
    }, {
      status: boolean;
    }>;
    readonly updateSession: better_call0.StrictEndpoint<"/update-session", {
      method: "POST";
      operationId: string;
      body: zod.ZodRecord<zod.ZodString, zod.ZodAny>;
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
        $Infer: {
          body: Partial<AdditionalSessionFieldsInput<Option>>;
        };
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
                      session: {
                        type: string;
                        $ref: string;
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
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      };
    }>;
    readonly updateUser: better_call0.StrictEndpoint<"/update-user", {
      method: "POST";
      operationId: string;
      body: zod.ZodRecord<zod.ZodString, zod.ZodAny>;
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
        $Infer: {
          body: Partial<AdditionalUserFieldsInput<Option>> & {
            name?: string | undefined;
            image?: string | undefined | null;
          };
        };
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    name: {
                      type: string;
                      description: string;
                    };
                    image: {
                      type: string;
                      description: string;
                      nullable: boolean;
                    };
                  };
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        $ref: string;
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
      status: boolean;
    }>;
    readonly deleteUser: better_call0.StrictEndpoint<"/delete-user", {
      method: "POST";
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
      body: zod.ZodObject<{
        callbackURL: zod.ZodOptional<zod.ZodString>;
        password: zod.ZodOptional<zod.ZodString>;
        token: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    callbackURL: {
                      type: string;
                      description: string;
                    };
                    password: {
                      type: string;
                      description: string;
                    };
                    token: {
                      type: string;
                      description: string;
                    };
                  };
                };
              };
            };
          };
          responses: {
            "200": {
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
                      message: {
                        type: string;
                        enum: string[];
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
      success: boolean;
      message: string;
    }>;
    readonly requestPasswordReset: better_call0.StrictEndpoint<"/request-password-reset", {
      method: "POST";
      body: zod.ZodObject<{
        email: zod.ZodEmail;
        redirectTo: zod.ZodOptional<zod.ZodString>;
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
                      status: {
                        type: string;
                      };
                      message: {
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
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
    }, {
      status: boolean;
      message: string;
    }>;
    readonly requestPasswordResetCallback: better_call0.StrictEndpoint<"/reset-password/:token", {
      method: "GET";
      operationId: string;
      query: zod.ZodObject<{
        callbackURL: zod.ZodString;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
      metadata: {
        openapi: {
          operationId: string;
          description: string;
          parameters: ({
            name: string;
            in: "path";
            required: true;
            description: string;
            schema: {
              type: "string";
            };
          } | {
            name: string;
            in: "query";
            required: true;
            description: string;
            schema: {
              type: "string";
            };
          })[];
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      token: {
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
    }, never>;
    readonly listSessions: better_call0.StrictEndpoint<"/list-sessions", {
      method: "GET";
      operationId: string;
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
      requireHeaders: true;
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
                    type: "array";
                    items: {
                      $ref: string;
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, Prettify$1<{
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      expiresAt: Date;
      token: string;
      ipAddress?: string | null | undefined;
      userAgent?: string | null | undefined;
    } & _better_auth_core_db0.InferDBFieldsFromOptions<Option["session"]> & _better_auth_core_db0.InferDBFieldsFromPlugins<"session", Option["plugins"]> extends infer T_12 ? { [K_2 in keyof T_12]: T_12[K_2] } : never>[]>;
    readonly revokeSession: better_call0.StrictEndpoint<"/revoke-session", {
      method: "POST";
      body: zod.ZodObject<{
        token: zod.ZodString;
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
      requireHeaders: true;
      metadata: {
        openapi: {
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    token: {
                      type: string;
                      description: string;
                    };
                  };
                  required: string[];
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
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
      status: boolean;
    }>;
    readonly revokeSessions: better_call0.StrictEndpoint<"/revoke-sessions", {
      method: "POST";
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
      requireHeaders: true;
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
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
      status: boolean;
    }>;
    readonly revokeOtherSessions: better_call0.StrictEndpoint<"/revoke-other-sessions", {
      method: "POST";
      requireHeaders: true;
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
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
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
      status: boolean;
    }>;
    readonly linkSocialAccount: better_call0.StrictEndpoint<"/link-social", {
      method: "POST";
      requireHeaders: true;
      body: zod.ZodObject<{
        callbackURL: zod.ZodOptional<zod.ZodString>;
        provider: zod.ZodType<(string & {}) | "linear" | "huggingface" | "github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat", unknown, zod_v4_core0.$ZodTypeInternals<(string & {}) | "linear" | "huggingface" | "github" | "apple" | "atlassian" | "cognito" | "discord" | "facebook" | "figma" | "microsoft" | "google" | "slack" | "spotify" | "twitch" | "twitter" | "dropbox" | "kick" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "salesforce" | "vk" | "zoom" | "notion" | "kakao" | "naver" | "line" | "paybin" | "paypal" | "polar" | "railway" | "vercel" | "wechat", unknown>>;
        idToken: zod.ZodOptional<zod.ZodObject<{
          token: zod.ZodString;
          nonce: zod.ZodOptional<zod.ZodString>;
          accessToken: zod.ZodOptional<zod.ZodString>;
          refreshToken: zod.ZodOptional<zod.ZodString>;
          scopes: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
        }, zod_v4_core0.$strip>>;
        requestSignUp: zod.ZodOptional<zod.ZodBoolean>;
        scopes: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
        errorCallbackURL: zod.ZodOptional<zod.ZodString>;
        disableRedirect: zod.ZodOptional<zod.ZodBoolean>;
        additionalData: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodAny>>;
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
          description: string;
          operationId: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      url: {
                        type: string;
                        description: string;
                      };
                      redirect: {
                        type: string;
                        description: string;
                      };
                      status: {
                        type: string;
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
      url: string;
      redirect: boolean;
    }>;
    readonly listUserAccounts: better_call0.StrictEndpoint<"/list-accounts", {
      method: "GET";
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
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "array";
                    items: {
                      type: string;
                      properties: {
                        id: {
                          type: string;
                        };
                        providerId: {
                          type: string;
                        };
                        createdAt: {
                          type: string;
                          format: string;
                        };
                        updatedAt: {
                          type: string;
                          format: string;
                        };
                        accountId: {
                          type: string;
                        };
                        userId: {
                          type: string;
                        };
                        scopes: {
                          type: string;
                          items: {
                            type: string;
                          };
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
      };
    }, {
      scopes: string[];
      id: string;
      createdAt: Date;
      updatedAt: Date;
      userId: string;
      providerId: string;
      accountId: string;
    }[]>;
    readonly deleteUserCallback: better_call0.StrictEndpoint<"/delete-user/callback", {
      method: "GET";
      query: zod.ZodObject<{
        token: zod.ZodString;
        callbackURL: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>)[];
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
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
                      message: {
                        type: string;
                        enum: string[];
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
      success: boolean;
      message: string;
    }>;
    readonly unlinkAccount: better_call0.StrictEndpoint<"/unlink-account", {
      method: "POST";
      body: zod.ZodObject<{
        providerId: zod.ZodString;
        accountId: zod.ZodOptional<zod.ZodString>;
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
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
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
      status: boolean;
    }>;
    readonly refreshToken: better_call0.StrictEndpoint<"/refresh-token", {
      method: "POST";
      body: zod.ZodObject<{
        providerId: zod.ZodString;
        accountId: zod.ZodOptional<zod.ZodString>;
        userId: zod.ZodOptional<zod.ZodString>;
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
                      tokenType: {
                        type: string;
                      };
                      idToken: {
                        type: string;
                      };
                      accessToken: {
                        type: string;
                      };
                      refreshToken: {
                        type: string;
                      };
                      accessTokenExpiresAt: {
                        type: string;
                        format: string;
                      };
                      refreshTokenExpiresAt: {
                        type: string;
                        format: string;
                      };
                    };
                  };
                };
              };
            };
            400: {
              description: string;
            };
          };
        };
      };
    }, {
      accessToken: string | undefined;
      refreshToken: string;
      accessTokenExpiresAt: Date | undefined;
      refreshTokenExpiresAt: Date | null | undefined;
      scope: string | null | undefined;
      idToken: string | null | undefined;
      providerId: string;
      accountId: string;
    }>;
    readonly getAccessToken: better_call0.StrictEndpoint<"/get-access-token", {
      method: "POST";
      body: zod.ZodObject<{
        providerId: zod.ZodString;
        accountId: zod.ZodOptional<zod.ZodString>;
        userId: zod.ZodOptional<zod.ZodString>;
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
                      tokenType: {
                        type: string;
                      };
                      idToken: {
                        type: string;
                      };
                      accessToken: {
                        type: string;
                      };
                      accessTokenExpiresAt: {
                        type: string;
                        format: string;
                      };
                    };
                  };
                };
              };
            };
            400: {
              description: string;
            };
          };
        };
      };
    }, {
      accessToken: string;
      accessTokenExpiresAt: Date | undefined;
      scopes: string[];
      idToken: string | undefined;
    }>;
    readonly accountInfo: better_call0.StrictEndpoint<"/account-info", {
      method: "GET";
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
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        type: string;
                        properties: {
                          id: {
                            type: string;
                          };
                          name: {
                            type: string;
                          };
                          email: {
                            type: string;
                          };
                          image: {
                            type: string;
                          };
                          emailVerified: {
                            type: string;
                          };
                        };
                        required: string[];
                      };
                      data: {
                        type: string;
                        properties: {};
                        additionalProperties: boolean;
                      };
                    };
                    required: string[];
                    additionalProperties: boolean;
                  };
                };
              };
            };
          };
        };
      };
      query: zod.ZodOptional<zod.ZodObject<{
        accountId: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>>;
    }, {
      user: _better_auth_core_oauth20.OAuth2UserInfo;
      data: Record<string, any>;
    } | null>;
  } extends infer T_2 ? { [K in keyof T_2 as K extends keyof T_1 ? never : K]: T_2[K] } : never) & T_1> : never : never : never;
};
//#endregion
export { APIError, type AuthEndpoint, type AuthMiddleware, accountInfo, callbackOAuth, changeEmail, changePassword, checkEndpointConflicts, createAuthEndpoint, createAuthMiddleware, createEmailVerificationToken, deleteUser, deleteUserCallback, error, formCsrfMiddleware, freshSessionMiddleware, getAccessToken, getEndpoints, getIp, getOAuthState, getSession, getSessionFromCtx, getShouldSkipSessionRefresh, isAPIError, linkSocialAccount, listSessions, listUserAccounts, ok, optionsMiddleware, originCheck, originCheckMiddleware, refreshToken, requestOnlySessionMiddleware, requestPasswordReset, requestPasswordResetCallback, requireOrgRole, requireResourceOwnership, resetPassword, revokeOtherSessions, revokeSession, revokeSessions, router, sendVerificationEmail, sendVerificationEmailFn, sensitiveSessionMiddleware, sessionMiddleware, setPassword, setShouldSkipSessionRefresh, signInEmail, signInSocial, signOut, signUpEmail, unlinkAccount, updateSession, updateUser, verifyEmail, verifyPassword };