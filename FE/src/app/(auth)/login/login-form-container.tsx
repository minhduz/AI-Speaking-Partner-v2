'use client';

import { useRouter } from 'next/navigation';
import { LoginForm } from '@/components/auth/login-form/login-form';
import { useAuth } from '@/hooks/use-auth';

export function LoginFormContainer() {
  const { isLoading, error, handleLogin, handleGoogleAuth } = useAuth();
  const router = useRouter();

  const onGoogleAuth = async (credential: string) => {
    console.log('[LoginContainer] onGoogleAuth called');
    const result = await handleGoogleAuth(credential, () => {
      console.log('[LoginContainer] no-op onRedirect called');
    });
    console.log('[LoginContainer] result:', result);

    if (result?.isNewUser) {
      console.log('[LoginContainer] new user → push /register?from=google');
      router.push('/register?from=google');
    } else {
      console.log('[LoginContainer] existing user → push /chat');
      router.push('/chat');
    }
  };

  return (
    <LoginForm
      onSubmit={handleLogin}
      onGoogleAuth={onGoogleAuth}
      isLoading={isLoading}
      error={error}
    />
  );
}
