import type { LoginRequest } from '@/types/auth.types';

export interface LoginFormProps {
  onSubmit: (credentials: LoginRequest) => void;
  onGoogleAuth: (credential: string) => void;
  isLoading: boolean;
  error: string | null;
}
