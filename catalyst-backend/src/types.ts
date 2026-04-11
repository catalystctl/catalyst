import { FastifyRequest, FastifyInstance } from "fastify";
import type { WebSocketGateway } from "./websocket/gateway";

declare module "fastify" {
  interface FastifyRequest {
    user: {
      userId: string;
      email?: string;
      username?: string;
      isApiKeyAuth?: boolean;
      apiKeyPermissions?: Record<string, string[]>;
    };
    userForLockout?: {
      id: string;
      email: string;
      failedLoginAttempts: number;
      lockedUntil: Date | null;
    };
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
    wsGateway?: WebSocketGateway;
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL: string;
      BETTER_AUTH_SECRET?: string;
      PORT?: string;
      CORS_ORIGIN?: string;
      BACKEND_EXTERNAL_ADDRESS?: string;
      FRONTEND_URL?: string;
      PASSKEY_RP_ID?: string;
      NODE_ENV?: "development" | "production" | "test";
      LOG_LEVEL?: string;
      MAX_DISK_MB?: string;
    }
  }
}
