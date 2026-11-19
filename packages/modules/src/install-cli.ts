import { installModules } from "@office/platform";
import { createRegistry } from "./index.ts";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL required (owner role)"); process.exit(1); }
await installModules(url, createRegistry());
