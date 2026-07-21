import { z } from "zod";

/**
 * Server-side environment validation. Fails fast at boot if config is missing
 * or malformed. Only import from server code (route handlers, server components,
 * worker, scripts) — never from client components.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  PISTON_API_URL: z.string().url(),

  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 chars"),

  SESSION_COOKIE_NAME: z.string().default("contest_session"),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(43200),

  RATE_LIMIT_RUN_SUBMIT_SECONDS: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(65536),

  CONTEST_TIMEZONE: z.string().default("Asia/Kolkata"),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
