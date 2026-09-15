import { startApi } from "./api.ts";
import { startScheduler } from "./sync.ts";
import { log } from "./util.ts";

const PORT = Number(process.env.PORT ?? 8000);

const server = startApi(PORT);
// Once HTTP has drained, exit even if a local scraper still has a timer or
// network request pending. Its stored progress is resumed at the next launch.
server.once("close", () => process.exit(0));
if (process.env.NO_SYNC !== "1" && process.env.SYNC_MODE !== "external") startScheduler();
else log("sync runs separately or is disabled");
