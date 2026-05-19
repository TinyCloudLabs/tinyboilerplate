import type { Express } from "express";
import helmet from "helmet";

export function applySecurityDefaults(app: Express) {
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
}
