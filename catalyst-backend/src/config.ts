/**
 * Catalyst Backend - Environment Configuration
 */

export const config = {
  server: {
    port: parseInt(process.env.PORT || "3000"),
    host: "0.0.0.0",
    corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  },
  database: {
    url: process.env.DATABASE_URL || (() => { throw new Error("DATABASE_URL environment variable is required"); })(),
  },
  backend: {
    externalAddress: process.env.BACKEND_EXTERNAL_ADDRESS || "http://localhost:3000",
  },
};
