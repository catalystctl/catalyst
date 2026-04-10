import { Prettify as Prettify$1, UnionToIntersection } from "../types/helper.mjs";
import { InferRoute } from "../client/path-to-object.mjs";
import { InferErrorCodes, IsSignal, SessionQueryParams } from "../client/types.mjs";
import { InferAPI } from "../types/api.mjs";
import { Session, User } from "../types/models.mjs";
import { Auth } from "../types/auth.mjs";
import { setCookieToHeader } from "../cookies/cookie-utils.mjs";
import * as _better_auth_core0 from "@better-auth/core";
import { Awaitable, BetterAuthClientOptions, BetterAuthOptions } from "@better-auth/core";
import * as _better_auth_core_oauth20 from "@better-auth/core/oauth2";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";
import * as _better_auth_core_db_adapter0 from "@better-auth/core/db/adapter";
import * as better_call0 from "better-call";
import * as zod from "zod";
import * as nanostores from "nanostores";
import * as _better_fetch_fetch0 from "@better-fetch/fetch";
import { SuccessContext } from "@better-fetch/fetch";
import * as zod_v4_core0 from "zod/v4/core";

//#region src/test-utils/test-instance.d.ts
declare function getTestInstance<O extends Partial<BetterAuthOptions>, C extends BetterAuthClientOptions>(options?: O | undefined, config?: {
  clientOptions?: C;
  port?: number;
  disableTestUser?: boolean;
  testUser?: Partial<User>;
  testWith?: "sqlite" | "postgres" | "mongodb" | "mysql";
} | undefined): Promise<{
  auth: Auth<O>;
  client: UnionToIntersection<(C extends undefined ? {} : C) & {
    baseURL: string | undefined;
    fetchOptions: {
      customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
    };
  } extends infer T ? T extends (C extends undefined ? {} : C) & {
    baseURL: string | undefined;
    fetchOptions: {
      customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
    };
  } ? T extends {
    plugins: Array<infer Plugin>;
  } ? UnionToIntersection<Plugin extends _better_auth_core0.BetterAuthClientPlugin ? Plugin["getAtoms"] extends ((fetch: any) => infer Atoms) ? Atoms extends Record<string, any> ? { [key in keyof Atoms as IsSignal<key> extends true ? never : key extends string ? `use${Capitalize<key>}` : never]: Atoms[key] } : {} : {} : {}> : {} : never : never> & UnionToIntersection<InferRoute<((C extends undefined ? {} : C) & {
    baseURL: string | undefined;
    fetchOptions: {
      customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
    };
  })["plugins"] extends any[] ? Omit<InferAPI<Prettify$1<{
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
            user?: {
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } | undefined;
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
      };
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
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
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
          };
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
            };
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
      };
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
      };
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
            };
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
      };
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
          body: Partial<{}>;
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
          body: Partial<{}> & {
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
    }>[]>;
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
  }>>, keyof (((C extends undefined ? {} : C) & {
    baseURL: string | undefined;
    fetchOptions: {
      customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
    };
  })["plugins"] extends infer T_1 ? T_1 extends ((C extends undefined ? {} : C) & {
    baseURL: string | undefined;
    fetchOptions: {
      customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
    };
  })["plugins"] ? T_1 extends (infer Pl)[] ? UnionToIntersection<Pl extends {
    $InferServerPlugin: infer Plug;
  } ? Plug extends {
    endpoints: infer Endpoints;
  } ? Endpoints : {} : {}> : {} : never : never)> & (((C extends undefined ? {} : C) & {
    baseURL: string | undefined;
    fetchOptions: {
      customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
    };
  })["plugins"] extends infer T_2 ? T_2 extends ((C extends undefined ? {} : C) & {
    baseURL: string | undefined;
    fetchOptions: {
      customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
    };
  })["plugins"] ? T_2 extends (infer Pl)[] ? UnionToIntersection<Pl extends {
    $InferServerPlugin: infer Plug;
  } ? Plug extends {
    endpoints: infer Endpoints;
  } ? Endpoints : {} : {}> : {} : never : never) : InferAPI<Prettify$1<{
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
            user?: {
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } | undefined;
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
      };
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
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
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
          };
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
            };
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
      };
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
      };
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
            };
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
      };
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
          body: Partial<{}>;
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
          body: Partial<{}> & {
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
    }>[]>;
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
  }>>, (C extends undefined ? {} : C) & {
    baseURL: string | undefined;
    fetchOptions: {
      customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
    };
  }>> & (((C extends undefined ? {} : C) & {
    baseURL: string | undefined;
    fetchOptions: {
      customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
    };
  })["plugins"] extends (infer Plugin_1)[] ? UnionToIntersection<Plugin_1 extends _better_auth_core0.BetterAuthClientPlugin ? Plugin_1["getActions"] extends ((...args: any) => infer Actions) ? Actions : {} : {}> : {}) & UnionToIntersection<InferRoute<((C extends undefined ? {} : C) & {
    baseURL: string | undefined;
    fetchOptions: {
      customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
    };
  })["$InferAuth"] extends {
    plugins: infer Plugins;
  } ? Plugins extends (infer Plugin_2)[] ? Plugin_2 extends {
    endpoints: infer Endpoints_1;
  } ? Endpoints_1 : {} : {} : {}, (C extends undefined ? {} : C) & {
    baseURL: string | undefined;
    fetchOptions: {
      customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
    };
  }>> & {
    useSession: nanostores.Atom<{
      data: UnionToIntersection<InferRoute<((C extends undefined ? {} : C) & {
        baseURL: string | undefined;
        fetchOptions: {
          customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
        };
      })["plugins"] extends any[] ? Omit<InferAPI<Prettify$1<{
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
                user?: {
                  id: string;
                  createdAt: Date;
                  updatedAt: Date;
                  email: string;
                  emailVerified: boolean;
                  name: string;
                  image?: string | null | undefined;
                } | undefined;
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
          };
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
          };
          user: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
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
              };
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
                };
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
          };
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
          };
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
                };
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
          };
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
              body: Partial<{}>;
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
              body: Partial<{}> & {
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
        }>[]>;
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
      }>>, keyof (((C extends undefined ? {} : C) & {
        baseURL: string | undefined;
        fetchOptions: {
          customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
        };
      })["plugins"] extends infer T_3 ? T_3 extends ((C extends undefined ? {} : C) & {
        baseURL: string | undefined;
        fetchOptions: {
          customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
        };
      })["plugins"] ? T_3 extends (infer Pl)[] ? UnionToIntersection<Pl extends {
        $InferServerPlugin: infer Plug;
      } ? Plug extends {
        endpoints: infer Endpoints;
      } ? Endpoints : {} : {}> : {} : never : never)> & (((C extends undefined ? {} : C) & {
        baseURL: string | undefined;
        fetchOptions: {
          customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
        };
      })["plugins"] extends infer T_4 ? T_4 extends ((C extends undefined ? {} : C) & {
        baseURL: string | undefined;
        fetchOptions: {
          customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
        };
      })["plugins"] ? T_4 extends (infer Pl)[] ? UnionToIntersection<Pl extends {
        $InferServerPlugin: infer Plug;
      } ? Plug extends {
        endpoints: infer Endpoints;
      } ? Endpoints : {} : {}> : {} : never : never) : InferAPI<Prettify$1<{
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
                user?: {
                  id: string;
                  createdAt: Date;
                  updatedAt: Date;
                  email: string;
                  emailVerified: boolean;
                  name: string;
                  image?: string | null | undefined;
                } | undefined;
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
          };
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
          };
          user: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
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
              };
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
                };
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
          };
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
          };
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
                };
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
          };
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
              body: Partial<{}>;
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
              body: Partial<{}> & {
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
        }>[]>;
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
      }>>, (C extends undefined ? {} : C) & {
        baseURL: string | undefined;
        fetchOptions: {
          customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
        };
      }>> extends {
        getSession: () => Promise<infer Res>;
      } ? Res extends {
        data: null;
        error: {
          message?: string | undefined;
          status: number;
          statusText: string;
        };
      } | {
        data: infer S;
        error: null;
      } ? S : Res extends Record<string, any> ? Res : never : never;
      error: _better_fetch_fetch0.BetterFetchError | null;
      isPending: boolean;
      isRefetching: boolean;
      refetch: (queryParams?: {
        query?: SessionQueryParams;
      } | undefined) => Promise<void>;
    }>;
    $fetch: _better_fetch_fetch0.BetterFetch<{
      plugins: (_better_fetch_fetch0.BetterFetchPlugin<Record<string, any>> | {
        id: string;
        name: string;
        hooks: {
          onSuccess(context: SuccessContext<any>): void;
        };
      } | {
        id: string;
        name: string;
        hooks: {
          onSuccess: ((context: SuccessContext<any>) => Promise<void> | void) | undefined;
          onError: ((context: _better_fetch_fetch0.ErrorContext) => Promise<void> | void) | undefined;
          onRequest: (<T_5 extends Record<string, any>>(context: _better_fetch_fetch0.RequestContext<T_5>) => Promise<_better_fetch_fetch0.RequestContext | void> | _better_fetch_fetch0.RequestContext | void) | undefined;
          onResponse: ((context: _better_fetch_fetch0.ResponseContext) => Promise<Response | void | _better_fetch_fetch0.ResponseContext> | Response | _better_fetch_fetch0.ResponseContext | void) | undefined;
        };
      })[];
      priority?: RequestPriority | undefined;
      cache?: RequestCache | undefined;
      credentials?: RequestCredentials;
      headers?: (HeadersInit & (HeadersInit | {
        accept: "application/json" | "text/plain" | "application/octet-stream";
        "content-type": "application/json" | "text/plain" | "application/x-www-form-urlencoded" | "multipart/form-data" | "application/octet-stream";
        authorization: "Bearer" | "Basic";
      })) | undefined;
      integrity?: string | undefined;
      keepalive?: boolean | undefined;
      method: string;
      mode?: RequestMode | undefined;
      redirect?: RequestRedirect | undefined;
      referrer?: string | undefined;
      referrerPolicy?: ReferrerPolicy | undefined;
      signal?: (AbortSignal | null) | undefined;
      window?: null | undefined;
      onRetry?: ((response: _better_fetch_fetch0.ResponseContext) => Promise<void> | void) | undefined;
      hookOptions?: {
        cloneResponse?: boolean;
      } | undefined;
      timeout?: number | undefined;
      customFetchImpl: _better_fetch_fetch0.FetchEsque;
      baseURL: string;
      throw?: boolean | undefined;
      auth?: ({
        type: "Bearer";
        token: string | Promise<string | undefined> | (() => string | Promise<string | undefined> | undefined) | undefined;
      } | {
        type: "Basic";
        username: string | (() => string | undefined) | undefined;
        password: string | (() => string | undefined) | undefined;
      } | {
        type: "Custom";
        prefix: string | (() => string | undefined) | undefined;
        value: string | (() => string | undefined) | undefined;
      }) | undefined;
      body?: any;
      query?: any;
      params?: any;
      duplex?: "full" | "half" | undefined;
      jsonParser: (text: string) => Promise<any> | any;
      retry?: _better_fetch_fetch0.RetryOptions | undefined;
      retryAttempt?: number | undefined;
      output?: (_better_fetch_fetch0.StandardSchemaV1 | typeof Blob | typeof File) | undefined;
      errorSchema?: _better_fetch_fetch0.StandardSchemaV1 | undefined;
      disableValidation?: boolean | undefined;
      disableSignal?: boolean | undefined;
    }, unknown, unknown, {}>;
    $store: {
      notify: (signal?: (Omit<string, "$sessionSignal"> | "$sessionSignal") | undefined) => void;
      listen: (signal: Omit<string, "$sessionSignal"> | "$sessionSignal", listener: (value: boolean, oldValue?: boolean | undefined) => void) => void;
      atoms: Record<string, nanostores.WritableAtom<any>>;
    };
    $Infer: {
      Session: NonNullable<UnionToIntersection<InferRoute<((C extends undefined ? {} : C) & {
        baseURL: string | undefined;
        fetchOptions: {
          customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
        };
      })["plugins"] extends any[] ? Omit<InferAPI<Prettify$1<{
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
                user?: {
                  id: string;
                  createdAt: Date;
                  updatedAt: Date;
                  email: string;
                  emailVerified: boolean;
                  name: string;
                  image?: string | null | undefined;
                } | undefined;
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
          };
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
          };
          user: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
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
              };
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
                };
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
          };
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
          };
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
                };
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
          };
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
              body: Partial<{}>;
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
              body: Partial<{}> & {
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
        }>[]>;
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
      }>>, keyof (((C extends undefined ? {} : C) & {
        baseURL: string | undefined;
        fetchOptions: {
          customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
        };
      })["plugins"] extends infer T_5 ? T_5 extends ((C extends undefined ? {} : C) & {
        baseURL: string | undefined;
        fetchOptions: {
          customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
        };
      })["plugins"] ? T_5 extends (infer Pl)[] ? UnionToIntersection<Pl extends {
        $InferServerPlugin: infer Plug;
      } ? Plug extends {
        endpoints: infer Endpoints;
      } ? Endpoints : {} : {}> : {} : never : never)> & (((C extends undefined ? {} : C) & {
        baseURL: string | undefined;
        fetchOptions: {
          customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
        };
      })["plugins"] extends infer T_6 ? T_6 extends ((C extends undefined ? {} : C) & {
        baseURL: string | undefined;
        fetchOptions: {
          customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
        };
      })["plugins"] ? T_6 extends (infer Pl)[] ? UnionToIntersection<Pl extends {
        $InferServerPlugin: infer Plug;
      } ? Plug extends {
        endpoints: infer Endpoints;
      } ? Endpoints : {} : {}> : {} : never : never) : InferAPI<Prettify$1<{
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
                user?: {
                  id: string;
                  createdAt: Date;
                  updatedAt: Date;
                  email: string;
                  emailVerified: boolean;
                  name: string;
                  image?: string | null | undefined;
                } | undefined;
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
          };
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
          };
          user: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
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
              };
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
                };
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
          };
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
          };
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
                };
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
          };
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
              body: Partial<{}>;
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
              body: Partial<{}> & {
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
        }>[]>;
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
      }>>, (C extends undefined ? {} : C) & {
        baseURL: string | undefined;
        fetchOptions: {
          customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
        };
      }>> extends {
        getSession: () => Promise<infer Res>;
      } ? Res extends {
        data: null;
        error: {
          message?: string | undefined;
          status: number;
          statusText: string;
        };
      } | {
        data: infer S;
        error: null;
      } ? S : Res extends Record<string, any> ? Res : never : never>;
    };
    $ERROR_CODES: InferErrorCodes<(C extends undefined ? {} : C) & {
      baseURL: string | undefined;
      fetchOptions: {
        customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
      };
    }> & {
      USER_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"USER_NOT_FOUND">;
      FAILED_TO_CREATE_USER: _better_auth_core_utils_error_codes0.RawError<"FAILED_TO_CREATE_USER">;
      FAILED_TO_CREATE_SESSION: _better_auth_core_utils_error_codes0.RawError<"FAILED_TO_CREATE_SESSION">;
      FAILED_TO_UPDATE_USER: _better_auth_core_utils_error_codes0.RawError<"FAILED_TO_UPDATE_USER">;
      FAILED_TO_GET_SESSION: _better_auth_core_utils_error_codes0.RawError<"FAILED_TO_GET_SESSION">;
      INVALID_PASSWORD: _better_auth_core_utils_error_codes0.RawError<"INVALID_PASSWORD">;
      INVALID_EMAIL: _better_auth_core_utils_error_codes0.RawError<"INVALID_EMAIL">;
      INVALID_EMAIL_OR_PASSWORD: _better_auth_core_utils_error_codes0.RawError<"INVALID_EMAIL_OR_PASSWORD">;
      INVALID_USER: _better_auth_core_utils_error_codes0.RawError<"INVALID_USER">;
      SOCIAL_ACCOUNT_ALREADY_LINKED: _better_auth_core_utils_error_codes0.RawError<"SOCIAL_ACCOUNT_ALREADY_LINKED">;
      PROVIDER_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"PROVIDER_NOT_FOUND">;
      INVALID_TOKEN: _better_auth_core_utils_error_codes0.RawError<"INVALID_TOKEN">;
      TOKEN_EXPIRED: _better_auth_core_utils_error_codes0.RawError<"TOKEN_EXPIRED">;
      ID_TOKEN_NOT_SUPPORTED: _better_auth_core_utils_error_codes0.RawError<"ID_TOKEN_NOT_SUPPORTED">;
      FAILED_TO_GET_USER_INFO: _better_auth_core_utils_error_codes0.RawError<"FAILED_TO_GET_USER_INFO">;
      USER_EMAIL_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"USER_EMAIL_NOT_FOUND">;
      EMAIL_NOT_VERIFIED: _better_auth_core_utils_error_codes0.RawError<"EMAIL_NOT_VERIFIED">;
      PASSWORD_TOO_SHORT: _better_auth_core_utils_error_codes0.RawError<"PASSWORD_TOO_SHORT">;
      PASSWORD_TOO_LONG: _better_auth_core_utils_error_codes0.RawError<"PASSWORD_TOO_LONG">;
      USER_ALREADY_EXISTS: _better_auth_core_utils_error_codes0.RawError<"USER_ALREADY_EXISTS">;
      USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: _better_auth_core_utils_error_codes0.RawError<"USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL">;
      EMAIL_CAN_NOT_BE_UPDATED: _better_auth_core_utils_error_codes0.RawError<"EMAIL_CAN_NOT_BE_UPDATED">;
      CREDENTIAL_ACCOUNT_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"CREDENTIAL_ACCOUNT_NOT_FOUND">;
      ACCOUNT_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"ACCOUNT_NOT_FOUND">;
      SESSION_EXPIRED: _better_auth_core_utils_error_codes0.RawError<"SESSION_EXPIRED">;
      FAILED_TO_UNLINK_LAST_ACCOUNT: _better_auth_core_utils_error_codes0.RawError<"FAILED_TO_UNLINK_LAST_ACCOUNT">;
      USER_ALREADY_HAS_PASSWORD: _better_auth_core_utils_error_codes0.RawError<"USER_ALREADY_HAS_PASSWORD">;
      CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: _better_auth_core_utils_error_codes0.RawError<"CROSS_SITE_NAVIGATION_LOGIN_BLOCKED">;
      VERIFICATION_EMAIL_NOT_ENABLED: _better_auth_core_utils_error_codes0.RawError<"VERIFICATION_EMAIL_NOT_ENABLED">;
      EMAIL_ALREADY_VERIFIED: _better_auth_core_utils_error_codes0.RawError<"EMAIL_ALREADY_VERIFIED">;
      EMAIL_MISMATCH: _better_auth_core_utils_error_codes0.RawError<"EMAIL_MISMATCH">;
      SESSION_NOT_FRESH: _better_auth_core_utils_error_codes0.RawError<"SESSION_NOT_FRESH">;
      LINKED_ACCOUNT_ALREADY_EXISTS: _better_auth_core_utils_error_codes0.RawError<"LINKED_ACCOUNT_ALREADY_EXISTS">;
      INVALID_ORIGIN: _better_auth_core_utils_error_codes0.RawError<"INVALID_ORIGIN">;
      INVALID_CALLBACK_URL: _better_auth_core_utils_error_codes0.RawError<"INVALID_CALLBACK_URL">;
      INVALID_REDIRECT_URL: _better_auth_core_utils_error_codes0.RawError<"INVALID_REDIRECT_URL">;
      INVALID_ERROR_CALLBACK_URL: _better_auth_core_utils_error_codes0.RawError<"INVALID_ERROR_CALLBACK_URL">;
      INVALID_NEW_USER_CALLBACK_URL: _better_auth_core_utils_error_codes0.RawError<"INVALID_NEW_USER_CALLBACK_URL">;
      MISSING_OR_NULL_ORIGIN: _better_auth_core_utils_error_codes0.RawError<"MISSING_OR_NULL_ORIGIN">;
      CALLBACK_URL_REQUIRED: _better_auth_core_utils_error_codes0.RawError<"CALLBACK_URL_REQUIRED">;
      FAILED_TO_CREATE_VERIFICATION: _better_auth_core_utils_error_codes0.RawError<"FAILED_TO_CREATE_VERIFICATION">;
      FIELD_NOT_ALLOWED: _better_auth_core_utils_error_codes0.RawError<"FIELD_NOT_ALLOWED">;
      ASYNC_VALIDATION_NOT_SUPPORTED: _better_auth_core_utils_error_codes0.RawError<"ASYNC_VALIDATION_NOT_SUPPORTED">;
      VALIDATION_ERROR: _better_auth_core_utils_error_codes0.RawError<"VALIDATION_ERROR">;
      MISSING_FIELD: _better_auth_core_utils_error_codes0.RawError<"MISSING_FIELD">;
      METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED: _better_auth_core_utils_error_codes0.RawError<"METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED">;
      BODY_MUST_BE_AN_OBJECT: _better_auth_core_utils_error_codes0.RawError<"BODY_MUST_BE_AN_OBJECT">;
      PASSWORD_ALREADY_SET: _better_auth_core_utils_error_codes0.RawError<"PASSWORD_ALREADY_SET">;
    } extends infer T_7 ? { [K in keyof T_7]: T_7[K] extends ((...args: any[]) => any) ? T_7[K] : T_7[K] extends object ? T_7[K] extends any[] ? T_7[K] : T_7[K] extends Date ? T_7[K] : T_7[K] extends infer T_8 ? { [K_2 in keyof T_8]: T_8[K_2] extends ((...args: any[]) => any) ? T_8[K_2] : T_8[K_2] extends object ? T_8[K_2] extends any[] ? T_8[K_2] : T_8[K_2] extends Date ? T_8[K_2] : T_8[K_2] extends infer T_9 ? { [K_3 in keyof T_9]: T_9[K_3] extends ((...args: any[]) => any) ? T_9[K_3] : T_9[K_3] extends object ? T_9[K_3] extends any[] ? T_9[K_3] : T_9[K_3] extends Date ? T_9[K_3] : T_9[K_3] extends infer T_10 ? { [K_4 in keyof T_10]: T_10[K_4] extends ((...args: any[]) => any) ? T_10[K_4] : T_10[K_4] extends object ? T_10[K_4] extends any[] ? T_10[K_4] : T_10[K_4] extends Date ? T_10[K_4] : T_10[K_4] extends infer T_11 ? { [K_5 in keyof T_11]: T_11[K_5] extends ((...args: any[]) => any) ? T_11[K_5] : T_11[K_5] extends object ? T_11[K_5] extends any[] ? T_11[K_5] : T_11[K_5] extends Date ? T_11[K_5] : T_11[K_5] extends infer T_12 ? { [K_6 in keyof T_12]: T_12[K_6] extends ((...args: any[]) => any) ? T_12[K_6] : T_12[K_6] extends object ? T_12[K_6] extends any[] ? T_12[K_6] : T_12[K_6] extends Date ? T_12[K_6] : T_12[K_6] extends infer T_13 ? { [K_7 in keyof T_13]: T_13[K_7] extends ((...args: any[]) => any) ? T_13[K_7] : T_13[K_7] extends object ? T_13[K_7] extends any[] ? T_13[K_7] : T_13[K_7] extends Date ? T_13[K_7] : T_13[K_7] extends infer T_14 ? { [K_8 in keyof T_14]: T_14[K_8] extends ((...args: any[]) => any) ? T_14[K_8] : T_14[K_8] extends object ? T_14[K_8] extends any[] ? T_14[K_8] : T_14[K_8] extends Date ? T_14[K_8] : T_14[K_8] extends infer T_15 ? { [K_9 in keyof T_15]: T_15[K_9] extends ((...args: any[]) => any) ? T_15[K_9] : T_15[K_9] extends object ? T_15[K_9] extends any[] ? T_15[K_9] : T_15[K_9] extends Date ? T_15[K_9] : T_15[K_9] extends infer T_16 ? { [K_10 in keyof T_16]: T_16[K_10] extends ((...args: any[]) => any) ? T_16[K_10] : T_16[K_10] extends object ? T_16[K_10] extends any[] ? T_16[K_10] : T_16[K_10] extends Date ? T_16[K_10] : T_16[K_10] extends infer T_17 ? { [K_11 in keyof T_17]: T_17[K_11] extends ((...args: any[]) => any) ? T_17[K_11] : T_17[K_11] extends object ? T_17[K_11] extends any[] ? T_17[K_11] : T_17[K_11] extends Date ? T_17[K_11] : /*elided*/any : T_17[K_11] } : never : T_16[K_10] } : never : T_15[K_9] } : never : T_14[K_8] } : never : T_13[K_7] } : never : T_12[K_6] } : never : T_11[K_5] } : never : T_10[K_4] } : never : T_9[K_3] } : never : T_8[K_2] } : never : T_7[K] } : never;
  };
  testUser: {
    id?: string | undefined;
    createdAt?: Date | undefined;
    updatedAt?: Date | undefined;
    email: string;
    emailVerified?: boolean | undefined;
    name: string;
    image?: string | null | undefined;
    password: string;
  };
  signInWithTestUser: () => Promise<{
    session: Session;
    user: User;
    headers: Headers;
    setCookie: (name: string, value: string) => void;
    runWithUser: (fn: (headers: Headers) => Promise<void>) => Promise<void>;
  }>;
  signInWithUser: (email: string, password: string) => Promise<{
    res: {
      user: User;
      session: Session;
    };
    headers: Headers;
  }>;
  cookieSetter: typeof setCookieToHeader;
  customFetchImpl: (url: string | URL | Request, init?: RequestInit | undefined) => Promise<Response>;
  sessionSetter: (headers: Headers) => (context: SuccessContext) => void;
  db: _better_auth_core_db_adapter0.DBAdapter<BetterAuthOptions>;
  runWithUser: (email: string, password: string, fn: (headers: Headers) => Awaitable<void>) => Promise<void>;
}>;
//#endregion
export { getTestInstance };