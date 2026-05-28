export const VOICE_OPTIONS = [
  { id: 'Maya', label: 'Maya', sub: 'Female - steady, clear' },
  { id: 'Daniel', label: 'Daniel', sub: 'Male - rich, steady' },
  { id: 'Noah', label: 'Noah', sub: 'Male - lively, youthful' },
  { id: 'Nina', label: 'Nina', sub: 'Female - bright, expressive' },
  { id: 'Emma', label: 'Emma', sub: 'Female - smooth, natural' },
  { id: 'Jack', label: 'Jack', sub: 'Male - friendly, confident' },
  { id: 'Adrian', label: 'Adrian', sub: 'Male - deep, focused' },
  { id: 'Claire', label: 'Claire', sub: 'Female - polished, articulate' },
  { id: 'Grace', label: 'Grace', sub: 'Female - gentle, soothing' },
  { id: 'Owen', label: 'Owen', sub: 'Male - grounded, composed' },
  { id: 'Mina', label: 'Mina', sub: 'Female - soft, thoughtful' },
  { id: 'Kenji', label: 'Kenji', sub: 'Male - calm, precise' },
  { id: 'Rafael', label: 'Rafael', sub: 'Male - warm Spanish accent' },
  { id: 'Mateo', label: 'Mateo', sub: 'Male - youthful Spanish accent' },
  { id: 'Lucia', label: 'Lucia', sub: 'Female - natural Spanish accent' },
  { id: 'Sofia', label: 'Sofia', sub: 'Female - bright Spanish accent' },
  { id: 'Oliver', label: 'Oliver', sub: 'Male - refined British accent' },
  { id: 'Arthur', label: 'Arthur', sub: 'Male - deep British accent' },
  { id: 'Isla', label: 'Isla', sub: 'Female - bright British accent' },
  { id: 'Victoria', label: 'Victoria', sub: 'Female - elegant British accent' },
  { id: 'Cooper', label: 'Cooper', sub: 'Male - bold Australian accent' },
  { id: 'Mason', label: 'Mason', sub: 'Male - relaxed Australian accent' },
  { id: 'Ruby', label: 'Ruby', sub: 'Female - confident Australian accent' },
  { id: 'Elise', label: 'Elise', sub: 'Female - warm Australian accent' },
  { id: 'Arjun', label: 'Arjun', sub: 'Male - deep Indian accent' },
  { id: 'Rohan', label: 'Rohan', sub: 'Male - lively Indian accent' },
  { id: 'Priya', label: 'Priya', sub: 'Female - clear Indian accent' },
  { id: 'Meera', label: 'Meera', sub: 'Female - polished Indian accent' },
] as const;

export type VoiceId = typeof VOICE_OPTIONS[number]['id'];

const VOICE_ID_SET = new Set<string>(VOICE_OPTIONS.map((voice) => voice.id));
const LEGACY_VOICE_ALIASES: Record<string, VoiceId> = {
  Sophia: 'Sofia',
  Liam: 'Daniel',
  Olivia: 'Grace',
};

export function normalizeVoiceId(voiceId: string | null | undefined): VoiceId {
  const trimmed = voiceId?.trim();
  if (trimmed && VOICE_ID_SET.has(trimmed)) return trimmed as VoiceId;
  if (trimmed && LEGACY_VOICE_ALIASES[trimmed]) return LEGACY_VOICE_ALIASES[trimmed];
  return 'Adrian';
}

export const STYLE_OPTIONS = [
  { id: 'friendly', label: 'Friendly', desc: 'Warm, casual, like a supportive friend.' },
  { id: 'formal', label: 'Formal', desc: 'Polite, structured, no slang.' },
  { id: 'casual', label: 'Casual', desc: 'Relaxed and brief.' },
  { id: 'playful', label: 'Playful', desc: 'Light and witty.' },
  { id: 'professional', label: 'Professional', desc: 'Clear, focused, expert tone.' },
] as const;

export type ConversationStyle = typeof STYLE_OPTIONS[number]['id'];

export interface UserSettings {
  voiceId: VoiceId;
  speechRate: number;
  conversationStyle: ConversationStyle;
}

export interface UserProfile extends UserSettings {
  id: string;
  email: string;
  name: string;
  role: 'student' | 'teacher' | 'admin';
  targetLanguage: string;
  level: string;
  nativeLanguage: string;
  learningGoal: string | null;
  timezone: string;
}
