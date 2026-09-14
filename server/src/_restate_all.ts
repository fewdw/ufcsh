import { restateClosingLines } from "./sync.ts";
const started = Date.now();
const r = await restateClosingLines({ onPage: (done, total) => { if (done % 50 === 0) console.log(`${new Date().toISOString().slice(11, 19)} page ${done}/${total} (${Math.round((Date.now() - started) / 60000)}m)`); } });
console.log("DONE", JSON.stringify(r));
process.exit(0);
