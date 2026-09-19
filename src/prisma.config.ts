import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "@prisma/config";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: process.env.DATABASE_URL || "",
  },
  migrations: {
    seed: "npx tsx prisma/seed.ts",
  },
});