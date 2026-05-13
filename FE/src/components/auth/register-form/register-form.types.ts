import type { RegisterRequest } from '@/types/auth.types';

export interface RegisterFormProps {
  onSubmit: (data: RegisterRequest) => void;
  onGoogleAuth: (credential: string) => void;
  onUpdateProfile?: (data: { targetLanguage: string; level: string; nativeLanguage: string; learningGoal: string; timezone: string }) => void;
  googleOnboarding?: boolean;
  isLoading: boolean;
  error: string | null;
  onConfettiDone: () => void;
}

export type ProficiencyLevel = 'beginner' | 'intermediate' | 'advanced';

export const LANGUAGES = [
  { value: 'english',  label: 'English',            countryCode: 'gb' },
  { value: 'chinese',  label: 'Chinese (Mandarin)', countryCode: 'cn' },
  { value: 'japanese', label: 'Japanese',           countryCode: 'jp' },
  { value: 'korean',   label: 'Korean',             countryCode: 'kr' },
  { value: 'german',   label: 'German',             countryCode: 'de' },
  { value: 'french',   label: 'French',             countryCode: 'fr' },
  { value: 'spanish',  label: 'Spanish',            countryCode: 'es' },
] as const;

export const NATIVE_LANGUAGES = [
  { value: 'vietnamese', label: 'Vietnamese', countryCode: 'vn' },
  { value: 'english',    label: 'English',    countryCode: 'gb' },
  { value: 'chinese',    label: 'Chinese',    countryCode: 'cn' },
  { value: 'korean',     label: 'Korean',     countryCode: 'kr' },
  { value: 'japanese',   label: 'Japanese',   countryCode: 'jp' },
] as const;

export const LEARNING_GOALS = [
  { value: 'career',    label: 'Boost my career',       icon: 'Briefcase'     as const },
  { value: 'travel',    label: 'Prepare for travel',    icon: 'Plane'         as const },
  { value: 'education', label: 'Support my education',  icon: 'GraduationCap' as const },
  { value: 'connect',   label: 'Connect with people',   icon: 'Users'         as const },
  { value: 'fun',       label: 'Just for fun',          icon: 'Smile'         as const },
  { value: 'other',     label: 'Other',                 icon: 'MessageCircle' as const },
] as const;
