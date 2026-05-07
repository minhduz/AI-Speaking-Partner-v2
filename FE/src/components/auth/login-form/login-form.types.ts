import type { LoginRequest } from '@/types/auth.types';

export interface LoginFormProps {
  onSubmit: (credentials: LoginRequest) => void;
  isLoading: boolean;
  error: string | null;
}
