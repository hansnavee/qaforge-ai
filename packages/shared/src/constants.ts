export const PLAN_LIMITS = {
  FREE: {
    runsPerMonth: 5,
    seats: 1,
  },
  PRO: {
    runsPerMonth: 100,
    seats: 10,
  },
} as const;

export type PlanId = keyof typeof PLAN_LIMITS;
