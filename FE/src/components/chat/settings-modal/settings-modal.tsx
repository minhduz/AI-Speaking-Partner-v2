'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { userService } from '@/services/user.service';
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

export function SettingsPanel() {
  const [voiceId, setVoiceId] = useState<VoiceId>(DEFAULT_SETTINGS.voiceId);
  const [speechRate, setSpeechRate] = useState<number>(DEFAULT_SETTINGS.speechRate);
  const [style, setStyle] = useState<ConversationStyle>(DEFAULT_SETTINGS.conversationStyle);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewState, setPreviewState] = useState<{ voiceId: VoiceId; status: 'loading' | 'playing' } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialRef = useRef(DEFAULT_SETTINGS);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
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
        initialRef.current = snap;
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  const dirty =
    voiceId !== initialRef.current.voiceId ||
    speechRate !== initialRef.current.speechRate ||
    style !== initialRef.current.conversationStyle;

  const handlePreview = useCallback(async (id: VoiceId) => {
    if (previewState) return;
    setPreviewState({ voiceId: id, status: 'loading' });
    setSaved(false);
    try {
      const { audio_b64 } = await userService.previewVoice(id, speechRate);
      const audio = new Audio(`data:audio/mpeg;base64,${audio_b64}`);
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
      if (voiceId    !== initialRef.current.voiceId)          patch.voiceId = voiceId;
      if (speechRate !== initialRef.current.speechRate)       patch.speechRate = speechRate;
      if (style      !== initialRef.current.conversationStyle) patch.conversationStyle = style;
      if (Object.keys(patch).length > 0) {
        await userService.updateSettings(patch);
        initialRef.current = { voiceId, speechRate, conversationStyle: style };
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [voiceId, speechRate, style]);

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ fontFamily: 'Lexend, sans-serif' }}>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 h-full min-h-0">
        <aside className="xl:col-span-4 flex flex-col gap-5 min-h-0">
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
              <SummaryRow label="Speed" value={`${speechRate.toFixed(2)}×`} tone="green" />
              <SummaryRow label="Style" value={STYLE_OPTIONS.find(s => s.id === style)?.label ?? style} tone="orange" />
            </div>
          </section>

          <section className="rounded-3xl p-5 flex-1 min-h-0" style={{ background: '#dceeff', border: '2px solid #c8e6ff', boxShadow: '0 4px 0 #c8e6ff' }}>
            <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#004666' }}>Tip</p>
            <p className="mt-2 text-sm font-semibold" style={{ color: '#004666' }}>
              For shadowing practice, start around 0.95×–1.10×. Increase speed when pronunciation feels automatic.
            </p>
          </section>
        </aside>

        <section className="xl:col-span-8 min-h-0 rounded-3xl overflow-hidden flex flex-col" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
          <div className="px-6 py-5 shrink-0 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Controls</p>
              <h2 className="text-xl font-black" style={{ color: '#1a1c1c' }}>Voice & style</h2>
            </div>
            {loading ? (
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: '#58cc02' }}>
                <div className="w-5 h-5 rounded-full border-4 border-[#1e5000]/25 border-t-[#1e5000] animate-spin" />
              </div>
            ) : saved ? (
              <div className="px-4 py-2 rounded-2xl text-xs font-extrabold" style={{ background: '#d7ffb8', color: '#2b6c00' }}>
                Saved
              </div>
            ) : dirty ? (
              <div className="px-4 py-2 rounded-2xl text-xs font-extrabold" style={{ background: '#ffe9cc', color: '#683a00' }}>
                Unsaved changes
              </div>
            ) : null}
          </div>

          <div className="px-6 pb-5 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            <div className="grid gap-5">
              {error && (
                <div className="rounded-2xl px-4 py-3 text-sm font-bold" style={{ background: '#ffe0e0', color: '#9b1c1c', border: '2px solid #ffc6c6' }}>
                  {error}
                </div>
              )}

              <SettingsCard title="Voice" tone="blue">
                <div className="grid sm:grid-cols-2 gap-3">
                  {VOICE_OPTIONS.map((v) => {
                    const active = v.id === voiceId;
                    const previewForVoice = previewState?.voiceId === v.id ? previewState.status : null;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition active:translate-y-0.5"
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
                              e.preventDefault();
                              e.stopPropagation();
                              void handlePreview(v.id);
                            }
                          }}
                          aria-disabled={previewState !== null}
                          className="text-[11px] font-extrabold px-3 py-2 rounded-xl transition shrink-0 inline-flex items-center gap-1.5"
                          style={previewForVoice
                            ? { background: '#2fb8ff', color: '#004666' }
                            : { background: '#f3f3f3', color: '#6f7b64' }}
                        >
                          {previewForVoice === 'loading' && <span className="w-3 h-3 rounded-full border-2 border-[#004666]/25 border-t-[#004666] animate-spin" />}
                          {previewForVoice === 'loading' ? 'Loading…' : previewForVoice === 'playing' ? 'Playing…' : 'Preview'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </SettingsCard>

              <SettingsCard title="Speech speed" tone="green">
                <div className="rounded-2xl p-5" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 3px 0 #e2e2e2' }}>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-extrabold" style={{ color: '#6f7b64' }}>Slow</span>
                    <span className="text-3xl font-black tabular-nums" style={{ color: '#2b6c00' }}>{speechRate.toFixed(2)}×</span>
                    <span className="text-xs font-extrabold" style={{ color: '#6f7b64' }}>Fast</span>
                  </div>
                  <input
                    type="range"
                    min={0.75}
                    max={1.5}
                    step={0.05}
                    value={speechRate}
                    onChange={(e) => { setSpeechRate(parseFloat(e.target.value)); setSaved(false); }}
                    className="w-full accent-[#58cc02]"
                  />
                </div>
              </SettingsCard>

              <SettingsCard title="Conversation style" tone="orange">
                <div className="grid md:grid-cols-3 gap-3">
                  {STYLE_OPTIONS.map((s) => {
                    const active = s.id === style;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setStyle(s.id); setSaved(false); }}
                        className="flex min-h-[112px] flex-col items-start justify-between text-left rounded-2xl px-4 py-3 transition active:translate-y-0.5"
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

          <footer className="px-6 py-5 flex justify-end gap-3 shrink-0" style={{ background: '#ffffff' }}>
            <button
              onClick={() => {
                setVoiceId(initialRef.current.voiceId);
                setSpeechRate(initialRef.current.speechRate);
                setStyle(initialRef.current.conversationStyle);
                setSaved(false);
              }}
              disabled={!dirty || saving || loading}
              className="px-5 py-3 rounded-2xl text-sm font-extrabold transition active:translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#ffffff', color: '#6f7b64', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}
            >
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || loading || saving}
              className="px-6 py-3 rounded-2xl text-sm font-extrabold transition active:translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#58cc02', color: '#1e5000', boxShadow: '0 4px 0 #46a302' }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
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
