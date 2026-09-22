import { ScoringError } from "./scoring.ts";

const ACTIONS = new Set(["odds", "props", "career", "detail", "segments", "event", "clear-bfo", "birth", "wiki"]);

/** One concurrent repair per API process, with a verified snapshot before the day's first change. */
export function createRepairRunner<T>(
  snapshot: (day: string) => Promise<void>,
  repair: (action: string, target: string) => Promise<T>,
  audit: (entry: Record<string, unknown>) => void,
  now = Date.now,
) {
  let running = false;
  let backedUpDay = "";
  return async (action: string, target: string, actor: string): Promise<T> => {
    if (!ACTIONS.has(action) || !/^[a-f0-9]{16}$/i.test(target)) throw new ScoringError(400, "Unknown repair or target.");
    if (running) throw new ScoringError(503, "Another repair is running. Retry shortly.");
    running = true;
    const started = now();
    const day = new Date(started).toISOString().slice(0, 10);
    try {
      if (day !== backedUpDay) {
        await snapshot(day);
        backedUpDay = day;
      }
      const result = await repair(action, target);
      audit({ event: "admin_repair", actor, action, target, success: true, duration_ms: now() - started });
      return result;
    } catch (error) {
      audit({ event: "admin_repair", actor, action, target, success: false, duration_ms: now() - started, error: String(error) });
      throw error;
    } finally {
      running = false;
    }
  };
}
