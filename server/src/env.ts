import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Local credentials stay outside source control. Deployment environment wins.
const local = fileURLToPath(new URL("../../.env.local", import.meta.url));
if (existsSync(local)) process.loadEnvFile(local);
