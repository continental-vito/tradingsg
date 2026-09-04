import { z } from "zod";

/**
 * Every environment variable this app reads, validated once at import.
 *
 * A missing variable must fail here, by name, at startup — not three screens
 * deep as `undefined` concatenated into a URL. The error message names the file
 * to fix, because that is the next action.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),

  APP_URL: z.string().url().default("http://localhost:3000"),
  COMPANY_NAME: z.string().default("Acme Corp"),

  MARKET_DATA_PROVIDER: z.enum(["mock", "finnhub"]).default("mock"),
  FINNHUB_API_KEY: z.string().optional(),
  /** Seeds the synthetic price generator, so a reseed reproduces the same market. */
  MOCK_MARKET_SEED: z.coerce.number().int().default(20260904),

  EMAIL_PROVIDER: z.enum(["console", "smtp", "resend"]).default("console"),
  EMAIL_FROM: z.string().default("TradingSG <no-reply@example.com>"),
  EMAIL_OUTBOX_DIR: z.string().default(".mail"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  /** Bearer token the /api/cron/* routes require. Absent = those routes 404. */
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(
      `Environment is not configured:\n${missing.join("\n")}\n\n` +
        `Copy .env.example to .env and fill in the values it describes.`,
    );
  }
  return parsed.data;
}

export const env: Env = load();

/**
 * Selecting a provider without its credentials is a configuration mistake that
 * otherwise surfaces as a silent no-op at 07:00 on a Monday.
 */
export function assertProvidersConfigured(): void {
  if (env.MARKET_DATA_PROVIDER === "finnhub" && !env.FINNHUB_API_KEY) {
    throw new Error(
      "MARKET_DATA_PROVIDER=finnhub but FINNHUB_API_KEY is empty. " +
        "Get a free key at https://finnhub.io/register, or set MARKET_DATA_PROVIDER=mock.",
    );
  }
  if (env.EMAIL_PROVIDER === "smtp" && (!env.SMTP_HOST || !env.SMTP_USER)) {
    throw new Error(
      "EMAIL_PROVIDER=smtp but SMTP_HOST or SMTP_USER is empty. " +
        "Fill both in .env, or set EMAIL_PROVIDER=console to write emails to disk instead.",
    );
  }
  if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) {
    throw new Error(
      "EMAIL_PROVIDER=resend but RESEND_API_KEY is empty. " +
        "Get a key at https://resend.com/api-keys, or set EMAIL_PROVIDER=console.",
    );
  }
}
