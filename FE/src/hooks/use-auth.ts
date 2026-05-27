'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authService } from '@/services/auth.service';
import { useAuthContext } from '@/contexts/auth-context';
import { stopAllAudio } from './use-chat';
import { roleFromToken, homePathForRole } from '@/lib/roles';
import type { LoginRequest, RegisterRequest } from '@/types/auth.types';

export function useAuth() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login, logout } = useAuthContext();
  const router = useRouter();

  const handleLogin = async (credentials: LoginRequest) => {
    setIsLoading(true);
    setError(null);
    try {
      const { access_token } = await authService.login(credentials);
      login(access_token);
      router.push(homePathForRole(roleFromToken(access_token)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (data: RegisterRequest, onRedirect?: () => void) => {
    setIsLoading(true);
    setError(null);
    try {
      const { access_token } = await authService.register(data);
      login(access_token);
      if (onRedirect) {
        onRedirect();
      } else {
        router.push('/chat');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleAuth = async (credential: string, onRedirect?: () => void) => {
    setIsLoading(true);
    setError(null);
    try {
      const { access_token, isNewUser } = await authService.googleAuth(credential);
      const role = roleFromToken(access_token);
      console.log('[handleGoogleAuth] isNewUser:', isNewUser, '| hasOnRedirect:', !!onRedirect);
      login(access_token);

      if (onRedirect) {
        console.log('[handleGoogleAuth] calling onRedirect');
        onRedirect();
      } else if (!isNewUser) {
        router.push(homePathForRole(role));
      } else {
        console.log('[handleGoogleAuth] new user, no onRedirect → letting caller handle');
      }

      return { isNewUser, role };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google authentication failed');
      return { isNewUser: false, role: 'student' as const };
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateProfile = async (
    data: { targetLanguage: string; level: string; nativeLanguage: string; learningGoal: string; timezone: string },
    onRedirect?: () => void,
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const { httpClient } = await import('@/lib/http-client');
      await httpClient.put('/user/me', data);
      if (onRedirect) {
        onRedirect();
      } else {
        router.push('/chat');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    stopAllAudio();
    window.google?.accounts?.id?.disableAutoSelect();
    await logout();
    router.push('/login');
  };

  return { isLoading, error, handleLogin, handleRegister, handleGoogleAuth, handleUpdateProfile, handleLogout };
}
