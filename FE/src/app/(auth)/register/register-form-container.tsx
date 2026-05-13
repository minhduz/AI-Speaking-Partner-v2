'use client';

import { useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RegisterForm } from '@/components/auth/register-form/register-form';
import { useAuth } from '@/hooks/use-auth';
import type { RegisterRequest } from '@/types/auth.types';

export function RegisterFormContainer() {
  const { isLoading, error, handleRegister, handleGoogleAuth, handleUpdateProfile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const googleOnboarding = searchParams.get('from') === 'google';
  console.log('[RegisterFormContainer] mounted — googleOnboarding:', googleOnboarding, '| from param:', searchParams.get('from'));

  // Holds the redirect function until confetti signals it's done
  const pendingRedirect = useRef<(() => void) | null>(null);

  const handleSubmit = useCallback(async (data: RegisterRequest) => {
    await handleRegister(data, () => {
      pendingRedirect.current = () => router.push('/chat');
    });
  }, [handleRegister, router]);

  const handleGoogleSubmit = useCallback(async (credential: string) => {
    await handleGoogleAuth(credential, () => {
      pendingRedirect.current = () => router.push('/chat');
    });
  }, [handleGoogleAuth, router]);

  const handleProfileUpdate = useCallback(async (data: {
    targetLanguage: string; level: string; nativeLanguage: string; learningGoal: string; timezone: string;
  }) => {
    await handleUpdateProfile(data, () => {
      pendingRedirect.current = () => router.push('/chat');
    });
  }, [handleUpdateProfile, router]);

  // Called by ScreenSuccess when confetti animation ends
  const handleConfettiDone = useCallback(() => {
    pendingRedirect.current?.();
    pendingRedirect.current = null;
  }, []);

  return (
    <RegisterForm
      onSubmit={handleSubmit}
      onGoogleAuth={handleGoogleSubmit}
      onUpdateProfile={googleOnboarding ? handleProfileUpdate : undefined}
      googleOnboarding={googleOnboarding}
      isLoading={isLoading}
      error={error}
      onConfettiDone={handleConfettiDone}
    />
  );
}
