import { startApi } from "./api.ts";
import { startScheduler } from "./sync.ts";
import { log } from "./util.ts";

const PORT = Number(process.env.PORT ?? 8000);

startApi(PORT);
if (process.env.NO_SYNC !== "1") startScheduler();
else log("sync disabled (NO_SYNC=1)");
