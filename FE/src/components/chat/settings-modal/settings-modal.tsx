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

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_SETTINGS = {
  voiceId: 'Adrian' as VoiceId,
  speechRate: 1.0,
  conversationStyle: 'friendly' as ConversationStyle,
};

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [voiceId, setVoiceId] = useState<VoiceId>(DEFAULT_SETTINGS.voiceId);
  const [speechRate, setSpeechRate] = useState<number>(DEFAULT_SETTINGS.speechRate);
  const [style, setStyle] = useState<ConversationStyle>(DEFAULT_SETTINGS.conversationStyle);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState<VoiceId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Snapshot of values when the modal opened — used to detect "no changes" so
  // Save is a no-op when nothing actually changed.
  const initialRef = useRef(DEFAULT_SETTINGS);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load current settings whenever the modal opens.
  useEffect(() => {
    if (!open) return;
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
    return () => { cancelled = true; };
  }, [open]);

  // Esc closes; click outside (handled by overlay) closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Stop any in-flight preview when modal closes — orphan audio is jarring.
  useEffect(() => {
    if (open) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPreviewing(null);
  }, [open]);

  const handlePreview = useCallback(async (id: VoiceId) => {
    if (previewing) return;
    setPreviewing(id);
    try {
      const { audio_b64 } = await userService.previewVoice(id, speechRate);
      const audio = new Audio(`data:audio/mpeg;base64,${audio_b64}`);
      audioRef.current = audio;
      audio.onended = () => setPreviewing(null);
      audio.onerror = () => setPreviewing(null);
      await audio.play();
    } catch (e) {
      setPreviewing(null);
      setError(e instanceof Error ? e.message : 'Preview failed');
    }
  }, [previewing, speechRate]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {};
      if (voiceId    !== initialRef.current.voiceId)          patch.voiceId = voiceId;
      if (speechRate !== initialRef.current.speechRate)       patch.speechRate = speechRate;
      if (style      !== initialRef.current.conversationStyle) patch.conversationStyle = style;
      if (Object.keys(patch).length > 0) {
        await userService.updateSettings(patch);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [voiceId, speechRate, style, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-lg font-bold text-gray-900">Voice & style</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="px-6 pb-6 flex flex-col gap-5 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          <Section title="Voice">
            <div className="flex flex-col gap-1.5">
              {VOICE_OPTIONS.map((v) => {
                const active = v.id === voiceId;
                return (
                  <div
                    key={v.id}
                    className={`flex items-center justify-between rounded-2xl border px-4 py-2.5 cursor-pointer transition-colors ${
                      active
                        ? 'border-[#8447FF] bg-violet-50'
                        : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                    }`}
                    onClick={() => setVoiceId(v.id)}
                  >
                    <div className="flex flex-col">
                      <span className={`text-sm font-semibold ${active ? 'text-[#8447FF]' : 'text-gray-800'}`}>
                        {v.label}
                      </span>
                      <span className="text-[11px] text-gray-400">{v.sub}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handlePreview(v.id); }}
                      disabled={previewing !== null}
                      className={`text-[11px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                        previewing === v.id
                          ? 'bg-[#8447FF] text-white'
                          : 'bg-white border border-gray-200 text-gray-600 hover:border-[#8447FF] hover:text-[#8447FF]'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {previewing === v.id ? 'Playing…' : 'Preview'}
                    </button>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="Speech speed">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-gray-400 w-10">Slow</span>
              <input
                type="range"
                min={0.75}
                max={1.5}
                step={0.05}
                value={speechRate}
                onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                className="flex-1 accent-[#8447FF]"
              />
              <span className="text-[11px] text-gray-400 w-10 text-right">Fast</span>
            </div>
            <div className="flex justify-center mt-1.5">
              <span className="text-xs font-semibold text-[#8447FF] tabular-nums">
                {speechRate.toFixed(2)}×
              </span>
            </div>
          </Section>

          <Section title="Conversation style">
            <div className="grid grid-cols-1 gap-1.5">
              {STYLE_OPTIONS.map((s) => {
                const active = s.id === style;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyle(s.id)}
                    className={`flex flex-col items-start text-left rounded-2xl border px-4 py-2.5 transition-colors ${
                      active
                        ? 'border-[#8447FF] bg-violet-50'
                        : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className={`text-sm font-semibold ${active ? 'text-[#8447FF]' : 'text-gray-800'}`}>
                      {s.label}
                    </span>
                    <span className="text-[11px] text-gray-400">{s.desc}</span>
                  </button>
                );
              })}
            </div>
          </Section>
        </div>

        <div className="px-6 pb-6 pt-2 flex gap-2 border-t border-gray-100 bg-white">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading || saving}
            className="flex-1 px-4 py-2.5 rounded-2xl bg-[#8447FF] text-white text-sm font-bold hover:bg-[#6e35ff] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-bold tracking-[0.14em] text-gray-400 uppercase">{title}</p>
      {children}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
