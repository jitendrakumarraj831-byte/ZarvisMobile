import { env } from "../config/env.js";

/**
 * Paid plans sold through Razorpay (UPI, cards, netbanking, wallets) in INR. The price, the
 * length of access and the credits granted live only here, on the server: the client sends a
 * plan key, never an amount, so a tampered request cannot change what is charged or granted.
 * Amounts are in paise (₹1 = 100 paise), Razorpay's smallest unit.
 */
export type PaidPlanKey = "pro_monthly" | "pro_yearly";

export interface PaidPlan {
  key: PaidPlanKey;
  entitlement: "PRO";
  name: string;
  period: "monthly" | "yearly";
  amountPaise: number;
  periodDays: number;
  /** Credits added to the account's balance when the payment is fulfilled. */
  credits: number;
}

export function paidPlans(): PaidPlan[] {
  return [
    {
      key: "pro_monthly",
      entitlement: "PRO",
      name: "Pro",
      period: "monthly",
      amountPaise: env.proMonthlyInr * 100,
      periodDays: 30,
      credits: env.proMonthlyCredits,
    },
    {
      key: "pro_yearly",
      entitlement: "PRO",
      name: "Pro",
      period: "yearly",
      amountPaise: env.proYearlyInr * 100,
      periodDays: 365,
      credits: env.proYearlyCredits,
    },
  ];
}

export function findPaidPlan(key: unknown): PaidPlan | undefined {
  return typeof key === "string" ? paidPlans().find((plan) => plan.key === key) : undefined;
}

/** Public shape for the client: display values derived from the same server-side numbers. */
export function describePlan(plan: PaidPlan) {
  const monthlyEquivalent = plan.period === "yearly" ? plan.amountPaise / 100 / 12 : plan.amountPaise / 100;
  const monthly = paidPlans().find((p) => p.period === "monthly");
  const savingsPercent =
    plan.period === "yearly" && monthly
      ? Math.max(0, Math.round((1 - plan.amountPaise / (monthly.amountPaise * 12)) * 100))
      : 0;
  return {
    key: plan.key,
    name: plan.name,
    period: plan.period,
    currency: "INR" as const,
    amountPaise: plan.amountPaise,
    amountInr: plan.amountPaise / 100,
    perMonthInr: Math.round(monthlyEquivalent),
    periodDays: plan.periodDays,
    credits: plan.credits,
    savingsPercent,
  };
}
