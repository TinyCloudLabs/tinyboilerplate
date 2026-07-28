import rateLimit from "express-rate-limit";
import type { Express } from "express";

const WINDOW_MS = 15 * 60 * 1000;
export const GLOBAL_LIMIT = 120;

/** Set trust proxy and mount the global rate limiter. */
export function applyRateLimiter(app: Express): void {
  app.set("trust proxy", 1);
  app.use(
    rateLimit({
      windowMs: WINDOW_MS,
      limit: GLOBAL_LIMIT,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );
}
