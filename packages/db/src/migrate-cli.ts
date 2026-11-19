import { migrate } from "./migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL required (owner role)"); process.exit(1); }
await migrate(url);
