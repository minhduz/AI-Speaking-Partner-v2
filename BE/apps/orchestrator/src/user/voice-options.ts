// Valid Soniox tts-rt-v1 voices from https://soniox.com/docs/tts/concepts/voices.
export const SONIOX_VOICES = [
  'Maya',
  'Daniel',
  'Noah',
  'Nina',
  'Emma',
  'Jack',
  'Adrian',
  'Claire',
  'Grace',
  'Owen',
  'Mina',
  'Kenji',
  'Rafael',
  'Mateo',
  'Lucia',
  'Sofia',
  'Oliver',
  'Arthur',
  'Isla',
  'Victoria',
  'Cooper',
  'Mason',
  'Ruby',
  'Elise',
  'Arjun',
  'Rohan',
  'Priya',
  'Meera',
] as const;

export type SonioxVoiceId = typeof SONIOX_VOICES[number];

const LEGACY_VOICE_ALIASES: Record<string, SonioxVoiceId> = {
  Sophia: 'Sofia',
  Liam: 'Daniel',
  Olivia: 'Grace',
};

export const ACCEPTED_VOICES = [
  ...SONIOX_VOICES,
  ...Object.keys(LEGACY_VOICE_ALIASES),
] as const;

const SONIOX_VOICE_SET = new Set<string>(SONIOX_VOICES);

export function normalizeVoiceId(voiceId: string | null | undefined): SonioxVoiceId {
  const trimmed = voiceId?.trim();
  if (trimmed && SONIOX_VOICE_SET.has(trimmed)) {
    return trimmed as SonioxVoiceId;
  }
  if (trimmed && LEGACY_VOICE_ALIASES[trimmed]) {
    return LEGACY_VOICE_ALIASES[trimmed];
  }
  return 'Adrian';
}
