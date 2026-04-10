import { InferOptionSchema } from "../../types/plugins.mjs";
import { WalletAddressSchema, schema } from "./schema.mjs";
import { ENSLookupArgs, ENSLookupResult, SIWEVerifyMessageArgs } from "./types.mjs";
import * as better_call0 from "better-call";
import * as z from "zod";

//#region src/plugins/siwe/index.d.ts
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    siwe: {
      creator: typeof siwe;
    };
  }
}
interface SIWEPluginOptions {
  domain: string;
  emailDomainName?: string | undefined;
  anonymous?: boolean | undefined;
  getNonce: () => Promise<string>;
  verifyMessage: (args: SIWEVerifyMessageArgs) => Promise<boolean>;
  ensLookup?: ((args: ENSLookupArgs) => Promise<ENSLookupResult>) | undefined;
  schema?: InferOptionSchema<typeof schema> | undefined;
}
declare const siwe: (options: SIWEPluginOptions) => {
  id: "siwe";
  version: string;
  schema: WalletAddressSchema;
  endpoints: {
    getSiweNonce: better_call0.StrictEndpoint<"/siwe/nonce", {
      method: "POST";
      body: z.ZodObject<{
        walletAddress: z.ZodString;
        chainId: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
      }, z.core.$strip>;
    }, {
      nonce: string;
    }>;
    verifySiweMessage: better_call0.StrictEndpoint<"/siwe/verify", {
      method: "POST";
      body: z.ZodObject<{
        message: z.ZodString;
        signature: z.ZodString;
        walletAddress: z.ZodString;
        chainId: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
        email: z.ZodOptional<z.ZodEmail>;
      }, z.core.$strip>;
      requireRequest: true;
    }, {
      token: string;
      success: boolean;
      user: {
        id: string;
        walletAddress: string;
        chainId: number;
      };
    }>;
  };
  options: SIWEPluginOptions;
};
//#endregion
export { SIWEPluginOptions, siwe };