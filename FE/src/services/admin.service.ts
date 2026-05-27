import { httpClient } from '@/lib/http-client';
import type { UserRole } from '@/types/auth.types';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  level: string;
  createdAt: string;
  session_count?: number;
  total_tokens?: number;
  estimated_cost_usd?: number;
  last_active_at?: string | null;
}

export interface CreateUserPayload {
  email: string;
  password: string;
  name: string;
  role: Extract<UserRole, 'teacher' | 'admin'>;
}

export interface AdminDashboard {
  users: { total: number; students: number; teachers: number; admins: number };
  sessions: { total: number; today: number; month: number };
  reviews: { pending: number; assigned: number; completed: number; overdue: number };
  usage: {
    total_tokens: number;
    rate_per_1k_tokens_usd: number;
    estimated_cost_usd: number;
  };
}

export interface AdminTeacher extends AdminUser {
  open_reviews: number;
  overdue_reviews: number;
  completed_reviews: number;
  average_rating: number;
  rating_count: number;
  completed_today: number;
  completed_this_month: number;
  completed_this_year: number;
}

export interface AdminTeacherStatsBucket {
  bucket: string;
  count: number;
}

export interface AdminTeacherDetail {
  teacher: AdminUser & {
    open_reviews?: number;
    overdue_reviews?: number;
    completed_reviews?: number;
  };
  queue: {
    assigned_open: number;
    pending_available: number;
    overdue: number;
    completed_today: number;
    completed_this_month: number;
    completed_this_year: number;
  };
  stats: {
    daily: AdminTeacherStatsBucket[];
    monthly: AdminTeacherStatsBucket[];
    yearly: AdminTeacherStatsBucket[];
    average_rating: number;
    rating_count: number;
    rating_distribution: Record<string, number>;
  };
  history: Array<{
    review_id: string;
    completed_at: string | null;
    reviewed_at: string | null;
    task_type: string | null;
    decision: string;
    final_score: number | null;
    human_score: number | null;
    note: string | null;
    student: { id: string; name: string; email: string } | null;
    lesson: { id: string; title: string; level: string; topic: string } | null;
    rating: number | null;
    rating_comment: string | null;
  }>;
  feedback: Array<{
    review_id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    student: { id: string; name: string; email: string } | null;
    lesson: { id: string; title: string; level: string; topic: string } | null;
  }>;
}

export interface AdminReviewTask {
  id: string;
  task_status: string;
  status: string;
  task_type: string | null;
  priority: number;
  due_at: string | null;
  review_reason: string | null;
  created_at: string;
  completed_at: string | null;
  assigned_to: string | null;
  reviewer_id: string | null;
  student: { id: string | null; name: string | null; email: string | null };
  assigned_teacher: { id: string; name: string; email: string; role: string } | null;
  reviewer: { id: string; name: string; email: string; role: string } | null;
  lesson: {
    id: string;
    title: string;
    level: string;
    topic: string;
    task_type: string;
    pass_score: number;
  } | null;
  attempt: {
    id: string;
    session_id: string | null;
    status: string;
    scoring_status: string;
    score: number | null;
    ai_score: number | null;
    final_score: number | null;
    finalized_at: string | null;
  } | null;
  ai_score: number | null;
  final_score: number | null;
}

export interface AdminUsage {
  summary: {
    total_tokens: number;
    rate_per_1k_tokens_usd: number;
    estimated_cost_usd: number;
  };
  users: Array<{
    user: Partial<AdminUser> & { id: string };
    session_count: number;
    total_tokens: number;
    estimated_cost_usd: number;
    last_active_at: string | null;
  }>;
}

export interface AdminUserDetail {
  user: AdminUser;
  sessions: Array<{
    id: string;
    title: string | null;
    status: string;
    mode: string;
    total_tokens: number;
    lesson_attempt_id: string | null;
    started_at: string;
    ended_at: string | null;
    last_activity_at: string | null;
  }>;
  attempts: Array<{
    id: string;
    session_id: string | null;
    lesson_id: string;
    lesson_title: string | null;
    status: string;
    score: number | null;
    final_score: number | null;
    scoring_status: string;
    review_required: boolean;
    started_at: string;
    completed_at: string | null;
    finalized_at: string | null;
  }>;
  reviews: Array<{
    id: string;
    task_status: string;
    status: string;
    task_type: string | null;
    priority: number;
    due_at: string | null;
    review_reason: string | null;
    lesson_title: string | null;
    assigned_teacher: { id: string; name: string; email: string; role: string } | null;
    final_score: number | null;
    created_at: string;
    completed_at: string | null;
  }>;
}

export const adminService = {
  dashboard: (): Promise<AdminDashboard> => httpClient.get<AdminDashboard>('/admin/dashboard'),

  listUsers: (params?: { role?: UserRole; q?: string }): Promise<AdminUser[]> => {
    const search = new URLSearchParams();
    if (params?.role) search.set('role', params.role);
    if (params?.q) search.set('q', params.q);
    const qs = search.toString();
    return httpClient.get<AdminUser[]>(`/admin/users${qs ? `?${qs}` : ''}`);
  },

  getUserDetail: (id: string): Promise<AdminUserDetail> =>
    httpClient.get<AdminUserDetail>(`/admin/users/${id}`),

  createUser: (payload: CreateUserPayload): Promise<AdminUser> =>
    httpClient.post<AdminUser>('/admin/users', payload),

  updateRole: (id: string, role: UserRole): Promise<AdminUser> =>
    httpClient.patch<AdminUser>(`/admin/users/${id}/role`, { role }),

  listTeachers: (): Promise<AdminTeacher[]> => httpClient.get<AdminTeacher[]>('/admin/teachers'),

  getTeacherDetail: (id: string): Promise<AdminTeacherDetail> =>
    httpClient.get<AdminTeacherDetail>(`/admin/teachers/${id}`),

  listReviews: (): Promise<AdminReviewTask[]> =>
    httpClient.get<AdminReviewTask[]>('/admin/reviews'),

  assignReview: (id: string, teacher_id: string | null): Promise<AdminReviewTask[]> =>
    httpClient.patch<AdminReviewTask[]>(`/admin/reviews/${id}/assign`, { teacher_id }),

  usage: (): Promise<AdminUsage> => httpClient.get<AdminUsage>('/admin/usage'),
};
