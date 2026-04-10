import { UserWithTwoFactor } from "../types.mjs";
import { Awaitable, GenericEndpointContext } from "@better-auth/core";
import * as better_call0 from "better-call";
import * as z from "zod";

//#region src/plugins/two-factor/otp/index.d.ts
interface OTPOptions {
  /**
   * How long the opt will be valid for in
   * minutes
   *
   * @default "3 mins"
   */
  period?: number | undefined;
  /**
   * Number of digits for the OTP code
   *
   * @default 6
   */
  digits?: number | undefined;
  /**
   * Send the otp to the user
   *
   * @param user - The user to send the otp to
   * @param otp - The otp to send
   * @param request - The request object
   * @returns void | Promise<void>
   */
  sendOTP?: ((
  /**
   * The user to send the otp to
   * @type UserWithTwoFactor
   * @default UserWithTwoFactors
   */
  data: {
    user: UserWithTwoFactor;
    otp: string;
  },
  /**
   * The request object
   */
  ctx?: GenericEndpointContext) => Awaitable<void>) | undefined;
  /**
   * The number of allowed attempts for the OTP
   *
   * @default 5
   */
  allowedAttempts?: number | undefined;
  storeOTP?: ("plain" | "encrypted" | "hashed" | {
    hash: (token: string) => Promise<string>;
  } | {
    encrypt: (token: string) => Promise<string>;
    decrypt: (token: string) => Promise<string>;
  }) | undefined;
}
/**
 * The otp adapter is created from the totp adapter.
 */
declare const otp2fa: (options?: OTPOptions | undefined) => {
  id: "otp";
  version: string;
  endpoints: {
    /**
     * ### Endpoint
     *
     * POST `/two-factor/send-otp`
     *
     * ### API Methods
     *
     * **server:**
     * `auth.api.sendTwoFactorOTP`
     *
     * **client:**
     * `authClient.twoFactor.sendOtp`
     *
     * @see [Read our docs to learn more.](https://better-auth.com/docs/plugins/2fa#api-method-two-factor-send-otp)
     */
    sendTwoFactorOTP: better_call0.StrictEndpoint<"/two-factor/send-otp", {
      method: "POST";
      body: z.ZodOptional<z.ZodObject<{
        trustDevice: z.ZodOptional<z.ZodBoolean>;
      }, z.core.$strip>>;
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
      status: boolean;
    }>;
    /**
     * ### Endpoint
     *
     * POST `/two-factor/verify-otp`
     *
     * ### API Methods
     *
     * **server:**
     * `auth.api.verifyTwoFactorOTP`
     *
     * **client:**
     * `authClient.twoFactor.verifyOtp`
     *
     * @see [Read our docs to learn more.](https://better-auth.com/docs/plugins/2fa#api-method-two-factor-verify-otp)
     */
    verifyTwoFactorOTP: better_call0.StrictEndpoint<"/two-factor/verify-otp", {
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
            "200": {
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
                        type: string;
                        properties: {
                          id: {
                            type: string;
                            description: string;
                          };
                          email: {
                            type: string;
                            format: string;
                            nullable: boolean;
                            description: string;
                          };
                          emailVerified: {
                            type: string;
                            nullable: boolean;
                            description: string;
                          };
                          name: {
                            type: string;
                            nullable: boolean;
                            description: string;
                          };
                          image: {
                            type: string;
                            format: string;
                            nullable: boolean;
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
export { OTPOptions, otp2fa };