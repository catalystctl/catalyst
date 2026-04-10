import { BackupCodeOptions } from "../backup-codes/index.mjs";
import { UserWithTwoFactor } from "../types.mjs";
import * as better_call0 from "better-call";
import * as z from "zod";

//#region src/plugins/two-factor/totp/index.d.ts
type TOTPOptions = {
  /**
   * Issuer
   */
  issuer?: string | undefined;
  /**
   * How many digits the otp to be
   *
   * @default 6
   */
  digits?: (6 | 8) | undefined;
  /**
   * Period for otp in seconds.
   * @default 30
   */
  period?: number | undefined;
  /**
   * Backup codes configuration
   */
  backupCodes?: BackupCodeOptions | undefined;
  /**
   * Allow retrieving the TOTP URI without a password when the user does not
   * have a credential account.
   * When enabled, password is still required if a credential account exists.
   * @default false
   */
  allowPasswordless?: boolean | undefined;
  /**
   * Disable totp
   */
  disable?: boolean | undefined;
};
declare const totp2fa: (options?: TOTPOptions | undefined) => {
  id: "totp";
  version: string;
  endpoints: {
    /**
     * ### Endpoint
     *
     * POST `/totp/generate`
     *
     * ### API Methods
     *
     * **server:**
     * `auth.api.generateTOTP`
     *
     * @see [Read our docs to learn more.](https://better-auth.com/docs/plugins/2fa#totp)
     */
    generateTOTP: better_call0.StrictEndpoint<string, {
      method: "POST";
      body: z.ZodObject<{
        secret: z.ZodString;
      }, z.core.$strip>;
      metadata: {
        openapi: {
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      code: {
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
      code: string;
    }>;
    /**
     * ### Endpoint
     *
     * POST `/two-factor/get-totp-uri`
     *
     * ### API Methods
     *
     * **server:**
     * `auth.api.getTOTPURI`
     *
     * **client:**
     * `authClient.twoFactor.getTotpUri`
     *
     * @see [Read our docs to learn more.](https://better-auth.com/docs/plugins/2fa#getting-totp-uri)
     */
    getTOTPURI: better_call0.StrictEndpoint<"/two-factor/get-totp-uri", {
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
      body: z.ZodObject<{
        password: z.ZodOptional<z.ZodString>;
      }, z.core.$strip> | z.ZodObject<{
        password: z.ZodString;
      }, z.core.$strip>;
      metadata: {
        openapi: {
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      totpURI: {
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
      totpURI: string;
    }>;
    /**
     * ### Endpoint
     *
     * POST `/two-factor/verify-totp`
     *
     * ### API Methods
     *
     * **server:**
     * `auth.api.verifyTOTP`
     *
     * **client:**
     * `authClient.twoFactor.verifyTotp`
     *
     * @see [Read our docs to learn more.](https://better-auth.com/docs/plugins/2fa#verifying-totp)
     */
    verifyTOTP: better_call0.StrictEndpoint<"/two-factor/verify-totp", {
      method: "POST";
      body: z.ZodObject<{
        code: z.ZodString;
        trustDevice: z.ZodOptional<z.ZodBoolean>;
      }, z.core.$strip>;
      metadata: {
        openapi: {
          summary: string;
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
      token: string;
      user: UserWithTwoFactor;
    } | {
      token: string;
      user: Record<string, any> & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    }>;
  };
};
//#endregion
export { TOTPOptions, totp2fa };