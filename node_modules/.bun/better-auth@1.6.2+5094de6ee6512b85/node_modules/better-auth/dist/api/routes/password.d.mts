import * as better_call0 from "better-call";
import * as z from "zod";

//#region src/api/routes/password.d.ts
declare const requestPasswordReset: better_call0.StrictEndpoint<"/request-password-reset", {
  method: "POST";
  body: z.ZodObject<{
    email: z.ZodEmail;
    redirectTo: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>;
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
declare const requestPasswordResetCallback: better_call0.StrictEndpoint<"/reset-password/:token", {
  method: "GET";
  operationId: string;
  query: z.ZodObject<{
    callbackURL: z.ZodString;
  }, z.core.$strip>;
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
declare const resetPassword: better_call0.StrictEndpoint<"/reset-password", {
  method: "POST";
  operationId: string;
  query: z.ZodOptional<z.ZodObject<{
    token: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>>;
  body: z.ZodObject<{
    newPassword: z.ZodString;
    token: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>;
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
declare const verifyPassword: better_call0.StrictEndpoint<"/verify-password", {
  method: "POST";
  body: z.ZodObject<{
    password: z.ZodString;
  }, z.core.$strip>;
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
//#endregion
export { requestPasswordReset, requestPasswordResetCallback, resetPassword, verifyPassword };