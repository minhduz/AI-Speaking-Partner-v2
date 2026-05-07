'use client';

import { RegisterForm } from '@/components/auth/register-form/register-form';
import { useAuth } from '@/hooks/use-auth';

export function RegisterFormContainer() {
  const { isLoading, error, handleRegister } = useAuth();
  return <RegisterForm onSubmit={handleRegister} isLoading={isLoading} error={error} />;
}
