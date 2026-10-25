"use strict";

const { spawnSync } = require("node:child_process");

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is not configured; database migrations were skipped. Configure it in Vercel and redeploy to enable applications and admin storage.");
  process.exit(0);
}

const migration = spawnSync(process.execPath, ["migrate.js"], { stdio: "inherit", env: process.env });
if (migration.error) throw migration.error;
process.exitCode = migration.status ?? 1;
