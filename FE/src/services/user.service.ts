import { httpClient } from '@/lib/http-client';
import type { UserProfile, UserSettings } from '@/types/user.types';

export const userService = {
  me: (): Promise<UserProfile> => httpClient.get<UserProfile>('/user/me'),

  updateSettings: (patch: Partial<UserSettings>): Promise<UserProfile> =>
    httpClient.put<UserProfile>('/user/me', patch),

  changePassword: (payload: { currentPassword?: string; newPassword: string }): Promise<void> =>
    httpClient.post<void>('/user/change-password', payload),

  previewVoice: (voiceId: string, speechRate: number, text?: string) =>
    httpClient.post<{ audio_b64: string; format: string }>('/user/voice-preview', {
      voiceId,
      speechRate,
      text,
    }),
};
