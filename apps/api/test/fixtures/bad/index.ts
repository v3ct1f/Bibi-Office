import { fileURLToPath } from "node:url";
import { defineModule } from "@office/sdk";
export default defineModule({
  manifest: { key: "bad", name: "Bad", version: "0.0.1", office: "^1.0" },
  migrationsDir: fileURLToPath(new URL("./migrations", import.meta.url)),
});
