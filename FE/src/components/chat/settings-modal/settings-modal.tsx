'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { userService } from '@/services/user.service';
import { setUserSpeechRate } from '@/hooks/use-chat';
import {
  VOICE_OPTIONS,
  STYLE_OPTIONS,
  normalizeVoiceId,
  type VoiceId,
  type ConversationStyle,
} from '@/types/user.types';

const DEFAULT_SETTINGS = {
  voiceId: 'Adrian' as VoiceId,
  speechRate: 1.0,
  conversationStyle: 'friendly' as ConversationStyle,
};

/* Voice accent groups */
const VOICE_GROUPS = [
  {
    id: 'american', label: 'American', flag: 'us',
    voices: ['Maya', 'Daniel', 'Noah', 'Nina', 'Emma', 'Jack', 'Adrian', 'Claire', 'Grace', 'Owen', 'Mina', 'Kenji'],
  },
  {
    id: 'british', label: 'British', flag: 'gb',
    voices: ['Oliver', 'Arthur', 'Isla', 'Victoria'],
  },
  {
    id: 'australian', label: 'Australian', flag: 'au',
    voices: ['Cooper', 'Mason', 'Ruby', 'Elise'],
  },
  {
    id: 'spanish', label: 'Spanish', flag: 'es',
    voices: ['Rafael', 'Mateo', 'Lucia', 'Sofia'],
  },
  {
    id: 'indian', label: 'Indian', flag: 'in',
    voices: ['Arjun', 'Rohan', 'Priya', 'Meera'],
  },
] as const;

type VoiceGroupId = typeof VOICE_GROUPS[number]['id'];

function groupForVoice(id: string): VoiceGroupId {
  return VOICE_GROUPS.find(g => (g.voices as readonly string[]).includes(id))?.id ?? 'american';
}

export function SettingsPanel() {
  const [voiceId, setVoiceId] = useState<VoiceId>(DEFAULT_SETTINGS.voiceId);
  const [speechRate, setSpeechRate] = useState<number>(DEFAULT_SETTINGS.speechRate);
  const [style, setStyle] = useState<ConversationStyle>(DEFAULT_SETTINGS.conversationStyle);
  const [initialSettings, setInitialSettings] = useState(DEFAULT_SETTINGS);
  const [activeGroup, setActiveGroup] = useState<VoiceGroupId>(groupForVoice(DEFAULT_SETTINGS.voiceId));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewState, setPreviewState] = useState<{ voiceId: VoiceId; status: 'loading' | 'playing' } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    userService.me()
      .then((u) => {
        if (cancelled) return;
        const snap = {
          voiceId: normalizeVoiceId(u.voiceId),
          speechRate: u.speechRate ?? 1.0,
          conversationStyle: (u.conversationStyle ?? 'friendly') as ConversationStyle,
        };
        setVoiceId(snap.voiceId);
        setSpeechRate(snap.speechRate);
        setStyle(snap.conversationStyle);
        setActiveGroup(groupForVoice(snap.voiceId)); // sync tab to loaded voice
        setInitialSettings(snap);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  const dirty =
    voiceId !== initialSettings.voiceId ||
    speechRate !== initialSettings.speechRate ||
    style !== initialSettings.conversationStyle;

  const handlePreview = useCallback(async (id: VoiceId) => {
    if (previewState) return;
    setPreviewState({ voiceId: id, status: 'loading' });
    setSaved(false);
    try {
      const { audio_b64 } = await userService.previewVoice(id, speechRate);
      const audio = new Audio(`data:audio/mpeg;base64,${audio_b64}`);
      // Soniox returns audio at native rate regardless of speech_rate, so the
      // slider is enforced here via HTMLAudioElement.playbackRate.
      audio.playbackRate = speechRate;
      audioRef.current = audio;
      audio.onended = () => setPreviewState(null);
      audio.onerror = () => setPreviewState(null);
      setPreviewState({ voiceId: id, status: 'playing' });
      await audio.play();
    } catch (e) {
      setPreviewState(null);
      setError(e instanceof Error ? e.message : 'Preview failed');
    }
  }, [previewState, speechRate]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const patch: Record<string, unknown> = {};
      if (voiceId    !== initialSettings.voiceId)          patch.voiceId = voiceId;
      if (speechRate !== initialSettings.speechRate)       patch.speechRate = speechRate;
      if (style      !== initialSettings.conversationStyle) patch.conversationStyle = style;
      if (Object.keys(patch).length > 0) {
        await userService.updateSettings(patch);
        setInitialSettings({ voiceId, speechRate, conversationStyle: style });
      }
      // Push the new rate to live chat playback immediately (no reload needed).
      setUserSpeechRate(speechRate);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [initialSettings, voiceId, speechRate, style]);

  return (
    <div className="min-w-0 lg:h-[calc(100dvh-112px)]" style={{ fontFamily: 'Lexend, sans-serif' }}>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5 lg:h-full lg:min-h-0">
        <aside className="min-w-0 lg:col-span-4 flex flex-col gap-4 lg:gap-5 lg:min-h-0">
          <section className="rounded-3xl p-6 overflow-hidden" style={{ background: '#d7ffb8', border: '2px solid #c8f2a4', boxShadow: '0 4px 0 #c8f2a4' }}>
            <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#2b6c00' }}>Your speaking setup</p>
            <h2 className="mt-2 text-3xl font-black leading-tight" style={{ color: '#1e5000' }}>
              Tune your AI partner
            </h2>
            <p className="mt-3 text-sm font-semibold" style={{ color: '#2b6c00' }}>
              Choose the voice, pace, and coaching style that feels easiest to practice with.
            </p>
            <div className="mt-5 h-36 flex items-end justify-center rounded-3xl" style={{ background: 'rgba(255,255,255,0.35)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/undraw_adjust-settings_6pis.svg" alt="Adjust settings" className="h-full w-full object-contain object-bottom px-2 pt-3" />
            </div>
          </section>

          <section className="rounded-3xl p-5" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
            <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Current setup</p>
            <div className="mt-4 grid gap-3">
              <SummaryRow label="Voice" value={VOICE_OPTIONS.find(v => v.id === voiceId)?.label ?? voiceId} tone="blue" />
              <SummaryRow label="Speed" value={`${speechRate.toFixed(2)}x`} tone="green" />
              <SummaryRow label="Style" value={STYLE_OPTIONS.find(s => s.id === style)?.label ?? style} tone="orange" />
            </div>
          </section>

        </aside>

        <section className="min-w-0 lg:col-span-8 rounded-3xl flex flex-col lg:min-h-0" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2', overflow: 'hidden' }}>
          <div className="px-5 sm:px-6 py-5 shrink-0 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Controls</p>
              <h2 className="text-xl font-black" style={{ color: '#1a1c1c' }}>Voice & style</h2>
            </div>
            {loading ? (
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: '#58cc02' }}>
                <div className="w-5 h-5 rounded-full border-4 border-[#1e5000]/25 border-t-[#1e5000] animate-spin" />
              </div>
            ) : saved ? (
              <div className="px-4 py-2 rounded-2xl text-xs font-extrabold" style={{ background: '#d7ffb8', color: '#2b6c00' }}>Saved</div>
            ) : dirty ? (
              <div className="px-4 py-2 rounded-2xl text-xs font-extrabold" style={{ background: '#ffe9cc', color: '#683a00' }}>Unsaved</div>
            ) : null}
          </div>

          <div className="px-3 pb-4 sm:px-6 sm:pb-6 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
            <div className="grid min-w-0 gap-4 sm:gap-5">
              {error && (
                <div className="rounded-2xl px-4 py-3 text-sm font-bold" style={{ background: '#ffe0e0', color: '#9b1c1c', border: '2px solid #ffc6c6' }}>
                  {error}
                </div>
              )}

              <SettingsCard title="Voice" tone="blue">
                {/* Accent group tabs */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {VOICE_GROUPS.map((group) => {
                    const isActive = group.id === activeGroup;
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setActiveGroup(group.id)}
                        className="flex min-w-0 items-center gap-2 rounded-2xl px-2.5 py-1.5 text-[11px] font-extrabold transition active:scale-95 sm:px-3 sm:text-xs"
                        style={isActive
                          ? { background: '#2fb8ff', color: '#004666', boxShadow: '0 2px 0 #006590', border: '2px solid #1c93d1' }
                          : { background: '#f3f3f3', color: '#6f7b64', border: '2px solid #e2e2e2' }}
                      >
                        <span
                          className="shrink-0 overflow-hidden"
                          style={{ width: 22, height: 14, borderRadius: 3, background: '#ffffff', border: '1px solid rgba(0,0,0,0.08)' }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`https://flagcdn.com/w40/${group.flag}.png`}
                            alt={group.label}
                            width={40}
                            height={27}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        </span>
                        {group.label}
                      </button>
                    );
                  })}
                </div>

                {/* Voices for active group */}
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  {VOICE_OPTIONS
                    .filter((v) => (VOICE_GROUPS.find(g => g.id === activeGroup)?.voices as readonly string[] ?? []).includes(v.id))
                    .map((v) => {
                      const active = v.id === voiceId;
                      const previewForVoice = previewState?.voiceId === v.id ? previewState.status : null;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          className="w-full min-w-0 overflow-hidden flex items-center justify-between gap-3 rounded-2xl px-3 py-3 text-left transition active:translate-y-0.5 sm:px-4"
                          style={active
                            ? { background: '#d7ffb8', border: '2px solid #58cc02', boxShadow: '0 3px 0 #46a302' }
                            : { background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 3px 0 #e2e2e2' }}
                          onClick={() => { setVoiceId(v.id); setSaved(false); }}
                        >
                          <span className="flex flex-col min-w-0">
                            <span className="text-sm font-black" style={{ color: active ? '#1e5000' : '#1a1c1c' }}>{v.label}</span>
                            <span className="text-[11px] font-semibold" style={{ color: active ? '#2b6c00' : '#6f7b64' }}>{v.sub}</span>
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); void handlePreview(v.id); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault(); e.stopPropagation(); void handlePreview(v.id);
                              }
                            }}
                            aria-disabled={previewState !== null}
                            aria-label={`Preview ${v.label}`}
                            title={previewForVoice === 'loading' ? 'Loading preview' : previewForVoice === 'playing' ? 'Playing preview' : `Preview ${v.label}`}
                            className="h-10 w-10 rounded-xl transition shrink-0 inline-flex items-center justify-center"
                            style={previewForVoice
                              ? { background: '#2fb8ff', color: '#004666' }
                              : { background: '#f3f3f3', color: '#6f7b64' }}
                          >
                            {previewForVoice === 'loading' ? (
                              <span className="h-4 w-4 rounded-full border-2 border-[#004666]/25 border-t-[#004666] animate-spin" />
                            ) : (
                              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                                <path d="M19 5a9 9 0 0 1 0 14" />
                              </svg>
                            )}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </SettingsCard>

              <SettingsCard title="Speech speed" tone="green">
                <div className="rounded-2xl p-5" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 3px 0 #e2e2e2' }}>
                  {/* Speed readout */}
                  <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Speed</span>
                      <span className="text-3xl font-black tabular-nums" style={{ color: '#2b6c00' }}>{speechRate.toFixed(2)}<span className="text-lg">x</span></span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[0.75, 0.9, 1.0, 1.15, 1.3].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => { setSpeechRate(v); setSaved(false); }}
                          className="px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold transition active:scale-95 sm:text-xs"
                          style={Math.abs(speechRate - v) < 0.01
                            ? { background: '#58cc02', color: '#1e5000', boxShadow: '0 2px 0 #46a302' }
                            : { background: '#f3f3f3', color: '#6f7b64', border: '2px solid #e2e2e2' }}
                        >
                          {v}x
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Tall hit area for mobile fingers */}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold shrink-0" style={{ color: '#afafaf' }}>0.75x</span>
                    <div className="flex-1 relative flex items-center" style={{ height: 44 }}>
                      <input
                        type="range"
                        min={0.75}
                        max={1.5}
                        step={0.05}
                        value={speechRate}
                        onChange={(e) => { setSpeechRate(parseFloat(e.target.value)); setSaved(false); }}
                        className="w-full accent-[#58cc02] cursor-pointer"
                        style={{ height: 44 }}
                      />
                    </div>
                    <span className="text-[10px] font-bold shrink-0" style={{ color: '#afafaf' }}>1.5x</span>
                  </div>
                </div>
              </SettingsCard>

              <SettingsCard title="Conversation style" tone="orange">
                <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {STYLE_OPTIONS.map((s) => {
                    const active = s.id === style;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setStyle(s.id); setSaved(false); }}
                        className="flex min-h-[86px] flex-col items-start gap-2 text-left rounded-2xl px-4 py-3 transition active:translate-y-0.5"
                        style={active
                          ? { background: '#ffe9cc', border: '2px solid #ff9c27', boxShadow: '0 3px 0 #d97800' }
                          : { background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 3px 0 #e2e2e2' }}
                      >
                        <span className="text-sm font-black" style={{ color: active ? '#683a00' : '#1a1c1c' }}>{s.label}</span>
                        <span className="text-[11px] font-semibold" style={{ color: active ? '#8a4b00' : '#6f7b64' }}>{s.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </SettingsCard>
            </div>
          </div>

          <footer className="px-3 py-4 sm:px-6 sm:py-5 flex flex-col gap-3 shrink-0 lg:flex-row lg:items-center lg:justify-between" style={{ background: '#ffffff', borderTop: '2px solid #f3f3f3' }}>
            <p className="text-[11px] font-bold leading-snug lg:max-w-[360px]" style={{ color: '#6f7b64' }}>
              Tip: for shadowing practice, start around 0.95x-1.10x. Increase speed once pronunciation feels automatic.
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <button
                onClick={() => {
                  setVoiceId(initialSettings.voiceId);
                  setSpeechRate(initialSettings.speechRate);
                  setStyle(initialSettings.conversationStyle);
                  setSaved(false);
                }}
                disabled={!dirty || saving || loading}
                className="min-w-0 flex-1 px-4 py-3 rounded-2xl text-sm font-extrabold transition active:translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed sm:flex-none sm:px-5"
                style={{ background: '#ffffff', color: '#6f7b64', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}
              >
                Reset
              </button>
              <button
                onClick={handleSave}
                disabled={!dirty || loading || saving}
                className="min-w-0 flex-1 px-4 py-3 rounded-2xl text-sm font-extrabold transition active:translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed sm:flex-none sm:px-6"
                style={{ background: '#58cc02', color: '#1e5000', boxShadow: '0 4px 0 #46a302' }}
              >
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, tone }: { label: string; value: string; tone: 'green' | 'blue' | 'orange' }) {
  const toneStyle = tone === 'green'
    ? { background: '#d7ffb8', color: '#2b6c00' }
    : tone === 'blue'
      ? { background: '#dceeff', color: '#004666' }
      : { background: '#ffe9cc', color: '#683a00' };

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: toneStyle.background }}>
      <span className="text-xs font-extrabold uppercase tracking-widest" style={{ color: toneStyle.color }}>{label}</span>
      <span className="text-sm font-black truncate" style={{ color: toneStyle.color }}>{value}</span>
    </div>
  );
}

function SettingsCard({ title, tone, children }: { title: string; tone: 'green' | 'blue' | 'orange'; children: React.ReactNode }) {
  const toneStyle = tone === 'green'
    ? { background: '#d7ffb8', color: '#2b6c00' }
    : tone === 'blue'
      ? { background: '#dceeff', color: '#004666' }
      : { background: '#ffe9cc', color: '#683a00' };

  return (
    <section className="rounded-3xl p-4" style={{ background: toneStyle.background, border: '2px solid rgba(0,0,0,0.06)' }}>
      <p className="mb-3 text-[11px] font-extrabold tracking-widest uppercase" style={{ color: toneStyle.color }}>{title}</p>
      {children}
    </section>
  );
}
