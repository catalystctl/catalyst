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
    url: process.env.DATABASE_URL || "postgresql://catalyst:catalyst_dev_password@localhost:5432/catalyst_db",
  },
  backend: {
    externalAddress: process.env.BACKEND_EXTERNAL_ADDRESS || "http://localhost:3000",
  },
};
