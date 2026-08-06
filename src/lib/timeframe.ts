import type { DateRange } from '../sellauth/types.js';

export const TIMEFRAMES = ['today', '7d', '30d', '90d', '365d', 'all'] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '365d': 'Last 365 days',
  all: 'All time'
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ALL_TIME_START = '2020-01-01';

const TIMEFRAME_DAYS: Record<Exclude<Timeframe, 'all' | 'today'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '365d': 365
};

function toIsoDate(date: Date): string {
  const isoDate = date.toISOString().split('T')[0];
  if (isoDate === undefined) {
    throw new Error(`Could not derive an ISO date from ${date.toISOString()}`);
  }
  return isoDate;
}

export function isTimeframe(value: string): value is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(value);
}

export function timeframeToDateRange(timeframe: Timeframe, now: Date = new Date()): DateRange {
  // End is tomorrow so that today's orders are always included.
  const end = toIsoDate(new Date(now.getTime() + MS_PER_DAY));

  switch (timeframe) {
    case 'all':
      return { start: ALL_TIME_START, end };
    case 'today':
      return { start: toIsoDate(now), end };
    default:
      return {
        start: toIsoDate(new Date(now.getTime() - TIMEFRAME_DAYS[timeframe] * MS_PER_DAY)),
        end
      };
  }
}
