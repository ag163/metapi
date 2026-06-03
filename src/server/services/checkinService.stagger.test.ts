import { describe, expect, it } from 'vitest';

import { buildScheduledCronSiteStaggerPlan } from './checkinService.js';

describe('buildScheduledCronSiteStaggerPlan', () => {
  it('can place the first account immediately and keep the minimum gap when random is 0', () => {
    const plan = buildScheduledCronSiteStaggerPlan([101, 102, 103], () => 0);

    expect(plan).toEqual([
      { accountId: 101, delayMs: 0 },
      { accountId: 102, delayMs: 20_000 },
      { accountId: 103, delayMs: 40_000 },
    ]);
  });

  it('keeps delays monotonic and within the configured stagger window', () => {
    const sequence = [0.5, 0.25, 0.75, 0.1];
    let index = 0;
    const plan = buildScheduledCronSiteStaggerPlan(
      [201, 202, 203],
      () => sequence[index++] ?? 0,
    );

    expect(plan[0]).toEqual({ accountId: 201, delayMs: 240_000 });
    expect(plan[1]).toEqual({ accountId: 202, delayMs: 273_750 });
    expect(plan[2]).toEqual({ accountId: 203, delayMs: 335_000 });
    expect(plan.map((item) => item.delayMs)).toEqual(
      [...plan.map((item) => item.delayMs)].sort((a, b) => a - b),
    );
  });
});
