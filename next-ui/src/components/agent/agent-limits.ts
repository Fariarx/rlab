export interface RateLimitWindow {
  readonly kind: "five_hour" | "weekly" | "daily" | "overage";
  readonly label?: string;
  readonly usedPercent?: number;
  readonly resetsAt?: number;
  readonly status?: string;
}

export interface AgentRateLimit {
  readonly updatedAt: number;
  readonly status?: string;
  readonly plan?: string;
  readonly windows: readonly RateLimitWindow[];
}

export type AgentRateLimitMap = Readonly<Record<string, AgentRateLimit>>;
