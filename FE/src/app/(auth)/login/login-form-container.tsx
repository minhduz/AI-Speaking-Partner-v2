'use client';

import { LoginForm } from '@/components/auth/login-form/login-form';
import { useAuth } from '@/hooks/use-auth';

export function LoginFormContainer() {
  const { isLoading, error, handleLogin } = useAuth();
  return <LoginForm onSubmit={handleLogin} isLoading={isLoading} error={error} />;
}
