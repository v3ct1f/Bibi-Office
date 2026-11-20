/** Runs the fake Claude API on a fixed port (browser tests, local runs): tsx fake-claude-cli.ts 3197 */
import { startFakeClaude } from "./fake-claude.ts";

const port = Number(process.argv[2] ?? 3197);
const f = await startFakeClaude(port);
console.log(`fake Claude listening on ${f.url}`);
