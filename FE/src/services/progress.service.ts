import { httpClient } from '@/lib/http-client';

export interface WeeklyDay {
  /** 'MON' … 'SUN' */
  day: string;
  /** Sessions started on this day of the current week. */
  count: number;
  is_today: boolean;
}

export interface DashboardStats {
  current_streak: number;
  weekly: WeeklyDay[];
  sessions_today: number;
}

export const progressService = {
  getDashboardStats: (): Promise<DashboardStats> =>
    httpClient.get<DashboardStats>('/progress/dashboard'),
};
