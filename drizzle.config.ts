import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.FMS_DATABASE_URL ??
      "postgresql://fms_admin:***@localhost:5439/fms_db",
  },
});
