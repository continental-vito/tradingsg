import { env } from "@/lib/env";
import { AdvisorError, type AllocationAdvisor } from "./advisor";
import { ClaudeAdvisor } from "./anthropic";

export * from "./advisor";

/** Whether an advisor can be built at all — the admin page says so up front. */
export function advisorConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export function createAdvisor(): AllocationAdvisor {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AdvisorError(
      "ANTHROPIC_API_KEY is not set, so the AI investor has no model to ask. Add it to the environment and redeploy.",
      "NOT_CONFIGURED",
    );
  }
  return new ClaudeAdvisor(env.ANTHROPIC_API_KEY);
}
