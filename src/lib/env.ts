import { z } from "zod";

/**
 * Every environment variable this app reads, validated once at import.
 *
 * A missing variable must fail here, by name, at startup — not three screens
 * deep as `undefined` concatenated into a URL. The error message names the file
 * to fix, because that is the next action.
 */
/**
 * The valid provider names, exported so the UI can list them without any page
 * hard-coding a provider's name. build/check-scripts.sh fails CI if one appears
 * outside its own adapter, and that check cannot tell a helpful sentence from a
 * real dependency — which is the right side to err on. One source of truth is
 * the better answer than an exception.
 */
export const EMAIL_PROVIDERS = ["console", "smtp", "resend"] as const;
export const MARKET_DATA_PROVIDERS = ["mock", "yahoo", "finnhub"] as const;

/**
 * Completes a bare hostname to https:// and drops trailing slashes.
 * Exported so it can be tested directly — see env.test.ts for the inputs that
 * broke a production build.
 */
export function normalizeAppUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),

  /**
   * The deployed origin, used to build links in email.
   *
   * Normalised rather than merely validated, because the two ways of getting
   * it wrong are both things a careful person does:
   *
   * - Vercel's dashboard shows the domain WITHOUT a scheme, so pasting what you
   *   see gives `tradingsg.vercel.app`, which is not a URL. That failed the
   *   whole production build with `APP_URL: Invalid URL` and no hint as to
   *   which of the many possible URLs it meant.
   * - A trailing slash makes every link `…app//reset-password/<token>`, which
   *   works but looks broken in somebody's inbox.
   *
   * A bare hostname is unambiguous, so it is completed to https:// rather than
   * rejected. Anything still unparseable fails with a message naming the fix.
   */
  APP_URL: z
    .string()
    .default("http://localhost:3000")
    .transform(normalizeAppUrl)
    .refine((value) => URL.parse(value) !== null, {
      message:
        "must be the deployed origin, e.g. https://your-app.vercel.app — a bare " +
        "hostname is fine, a path or a space is not",
    }),
  COMPANY_NAME: z.string().default("Acme Corp"),

  MARKET_DATA_PROVIDER: z.enum(MARKET_DATA_PROVIDERS).default("mock"),
  FINNHUB_API_KEY: z.string().optional(),
  /**
   * Seeds the synthetic price generator, so a reseed reproduces the same market.
   * 42 is not arbitrary: it was picked by measuring the six-week outcome across
   * candidate seeds and taking one that produces a MIXED market — mean +1.6%,
   * eight of eighteen names down, a -15% to +16% range. A seed where everything
   * rises makes every participant look like a genius, compresses the ranking,
   * and never exercises how a loss renders.
   */
  MOCK_MARKET_SEED: z.coerce.number().int().default(42),

  EMAIL_PROVIDER: z.enum(EMAIL_PROVIDERS).default("console"),
  EMAIL_FROM: z.string().default("TradingSG <no-reply@example.com>"),
  EMAIL_OUTBOX_DIR: z.string().default(".mail"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  /**
   * Key for the model behind the AI investor. Absent = the AI investor is
   * listed on the admin page but cannot decide anything, and says so.
   */
  ANTHROPIC_API_KEY: z.string().optional(),

  /** Bearer token the /api/cron/* routes require. Absent = those routes 404. */
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  // Loaded here rather than in each entry point, because imports are evaluated
  // before an entry point's first statement runs — so a loadEnvFile() call in
  // seed.ts or the job CLI happens strictly after this module has already
  // parsed process.env and thrown. Next loads .env itself; this is what makes
  // the plain-Node entry points work too. Node has done this natively since
  // 20.6, so it needs no dotenv dependency.
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // No .env file — CI and Vercel set the variables directly, and the parse
      // below fails by name if they have not.
    }
  }

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
