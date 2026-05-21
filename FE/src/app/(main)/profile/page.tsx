'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Download, KeyRound, LogOut, Settings2, ShieldCheck } from 'lucide-react';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { PageHeader } from '@/components/shared/page-header';
import { useAuthContext } from '@/contexts/auth-context';
import { userService } from '@/services/user.service';
import type { UserProfile } from '@/types/user.types';

function valueOrFallback(value: string | null | undefined, fallback = 'Not set') {
  return value?.trim() || fallback;
}

export default function ProfilePage() {
  const { logout } = useAuthContext();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    userService.me()
      .then((user) => { if (!cancelled) setProfile(user); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const initials = useMemo(() => {
    const name = profile?.name || profile?.email || 'User';
    return name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase())
      .join('') || 'U';
  }, [profile]);

  const handleChangePassword = async () => {
    setPasswordMessage(null);
    if (newPassword.length < 8) {
      setPasswordMessage({ type: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Password confirmation does not match.' });
      return;
    }

    setPasswordSaving(true);
    try {
      await userService.changePassword({
        currentPassword: currentPassword || undefined,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordOpen(false);
      setPasswordMessage({ type: 'success', text: 'Password updated successfully.' });
    } catch (e) {
      setPasswordMessage({ type: 'error', text: e instanceof Error ? e.message : 'Could not update password.' });
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="flex w-full h-full">
      <Sidebar
        onNewChat={() => router.push('/chat')}
        onLogout={logout}
        currentSessionId={null}
        onSessionClick={(session) => router.push(`/chat?sessionId=${session.id}`)}
      />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ background: '#f9f9f9', fontFamily: 'Lexend, sans-serif' }}>
        <PageHeader title="Profile" />

        <div
          className="flex-1 overflow-y-auto px-4 sm:px-8 custom-scrollbar"
          style={{ paddingBottom: 'max(88px, calc(72px + env(safe-area-inset-bottom, 0px)))' }}
        >
          <div className="max-w-6xl mx-auto py-4">
            {loading ? (
              <div className="h-[60vh] flex items-center justify-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#58cc02' }}>
                  <div className="w-6 h-6 rounded-full border-4 border-[#1e5000]/25 border-t-[#1e5000] animate-spin" />
                </div>
              </div>
            ) : error ? (
              <div className="rounded-3xl p-6 max-w-lg" style={{ background: '#ffe0e0', color: '#9b1c1c', border: '2px solid #ffc6c6', boxShadow: '0 4px 0 #ffc6c6' }}>
                <p className="font-black">Could not load your profile</p>
                <p className="text-sm font-semibold mt-1">{error}</p>
              </div>
            ) : profile && (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
                <section className="rounded-[32px] p-7" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
                  <div className="flex items-center gap-5 mb-8 pb-6" style={{ borderBottom: '2px solid #f0f0f0' }}>
                    <div className="w-20 h-20 rounded-[28px] flex items-center justify-center text-3xl font-black shrink-0" style={{ background: '#d7ffb8', color: '#2b6c00', border: '2px solid #c8f2a4', boxShadow: '0 4px 0 #c8f2a4' }}>
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Learner account</p>
                      <h2 className="text-3xl font-black truncate" style={{ color: '#1a1c1c', letterSpacing: '-0.02em' }}>{valueOrFallback(profile.name, 'Learner')}</h2>
                      <p className="text-sm font-semibold truncate" style={{ color: '#6f7b64' }}>{profile.email}</p>
                    </div>
                  </div>

                  <PreferenceSection title="Account">
                    <InfoRow label="Email" value={profile.email} />
                    <InfoRow label="Display name" value={valueOrFallback(profile.name, 'Learner')} />
                    <PasswordChangeRow
                      open={passwordOpen}
                      onToggle={() => {
                        setPasswordOpen((open) => !open);
                        setPasswordMessage(null);
                      }}
                      currentPassword={currentPassword}
                      newPassword={newPassword}
                      confirmPassword={confirmPassword}
                      onCurrentPasswordChange={setCurrentPassword}
                      onNewPasswordChange={setNewPassword}
                      onConfirmPasswordChange={setConfirmPassword}
                      saving={passwordSaving}
                      message={passwordMessage}
                      onSubmit={handleChangePassword}
                    />
                  </PreferenceSection>

                  <PreferenceSection title="Learning profile">
                    <InfoRow label="Level" value={valueOrFallback(profile.level)} />
                    <InfoRow label="Native language" value={valueOrFallback(profile.nativeLanguage)} />
                    <InfoRow label="Target language" value={valueOrFallback(profile.targetLanguage)} />
                    <InfoRow label="Timezone" value={valueOrFallback(profile.timezone)} />
                    <InfoRow label="Learning goal" value={valueOrFallback(profile.learningGoal)} />
                  </PreferenceSection>

                  <PreferenceSection title="Data & privacy" last>
                    <ActionRow icon={<Download size={18} />} title="Export learning data" desc="Download flashcards, profile, and progress history." tone="blue" />
                    <ActionRow icon={<ShieldCheck size={18} />} title="Privacy controls" desc="Manage saved learning data and personalization." tone="green" />
                    <ActionRow icon={<Bell size={18} />} title="Practice reminders" desc="Schedule nudges for your speaking routine." tone="green" />
                  </PreferenceSection>
                </section>

                <aside className="grid gap-4 lg:sticky lg:top-24">
                  <SideCard title="Account" items={['Profile', 'Password', 'Privacy settings']} tone="blue" />
                  <SideCard title="Practice" items={['Learning profile', 'Reminders', 'Data export']} tone="green" />
                  <div className="rounded-3xl p-4" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
                    <button
                      onClick={() => router.push('/settings')}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-2xl text-left font-extrabold transition-colors duration-200 hover:bg-[#fff1d9] active:translate-y-0.5"
                      style={{ background: '#ffe9cc', color: '#683a00', border: '2px solid #ffd19a', boxShadow: '0 3px 0 #ffd19a' }}
                    >
                      Voice settings
                      <Settings2 size={18} strokeWidth={2.5} />
                    </button>
                    <div className="my-4" style={{ borderTop: '2px solid #f1f1f1' }} />
                    <button
                      onClick={logout}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-2xl text-left font-extrabold transition-all duration-200 hover:-translate-y-0.5 hover:brightness-[1.01] active:translate-y-1"
                      style={{ background: '#fff5f5', color: '#9b1c1c', border: '2px solid #ffd6d6', boxShadow: '0 3px 0 #ffd6d6' }}
                    >
                      Sign out
                      <LogOut size={18} strokeWidth={2.5} />
                    </button>
                  </div>
                </aside>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function PreferenceSection({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <section className={last ? '' : 'mb-9'}>
      <h2 className="text-lg font-black mb-3" style={{ color: '#1a1c1c' }}>{title}</h2>
      <div className="rounded-3xl overflow-hidden" style={{ border: '2px solid #e8e8e8', boxShadow: '0 2px 0 #e8e8e8' }}>
        {children}
      </div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4 bg-white" style={{ borderBottom: '2px solid #f0f0f0' }}>
      <p className="text-sm font-extrabold" style={{ color: '#1a1c1c' }}>{label}</p>
      <p className="text-sm font-bold text-right break-words" style={{ color: '#6f7b64' }}>{value}</p>
    </div>
  );
}

function PasswordChangeRow({
  open,
  onToggle,
  currentPassword,
  newPassword,
  confirmPassword,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onConfirmPasswordChange,
  saving,
  message,
  onSubmit,
}: {
  open: boolean;
  onToggle: () => void;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  saving: boolean;
  message: { type: 'success' | 'error'; text: string } | null;
  onSubmit: () => void;
}) {
  return (
    <div style={{ borderBottom: '2px solid #f0f0f0' }}>
      <ActionRow
        icon={<KeyRound size={18} />}
        title="Change password"
        desc="Update your account password."
        tone="orange"
        onClick={onToggle}
        badge={open ? 'Close' : 'Edit'}
      />
      {open && (
        <div className="px-5 pb-5 bg-white">
          <div className="grid gap-3 max-w-md">
            <PasswordInput label="Current password" value={currentPassword} onChange={onCurrentPasswordChange} autoComplete="current-password" />
            <PasswordInput label="New password" value={newPassword} onChange={onNewPasswordChange} autoComplete="new-password" />
            <PasswordInput label="Confirm new password" value={confirmPassword} onChange={onConfirmPasswordChange} autoComplete="new-password" />
            {message && (
              <div className="rounded-2xl px-4 py-3 text-sm font-bold" style={message.type === 'success'
                ? { background: '#d7ffb8', color: '#2b6c00' }
                : { background: '#ffe0e0', color: '#9b1c1c' }}>
                {message.text}
              </div>
            )}
            <button
              type="button"
              onClick={onSubmit}
              disabled={saving}
              className="justify-self-start px-5 py-3 rounded-2xl text-sm font-extrabold transition-all duration-200 hover:-translate-y-0.5 hover:brightness-[1.03] active:translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              style={{ background: '#58cc02', color: '#1e5000', boxShadow: '0 4px 0 #46a302' }}
            >
              {saving ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PasswordInput({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-extrabold" style={{ color: '#6f7b64' }}>{label}</span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="px-4 py-3 rounded-2xl outline-none text-sm font-bold"
        style={{ background: '#f9f9f9', color: '#1a1c1c', border: '2px solid #e2e2e2' }}
      />
    </label>
  );
}

function ActionRow({ icon, title, desc, tone, onClick, badge = 'Soon' }: { icon: React.ReactNode; title: string; desc: string; tone: 'green' | 'blue' | 'orange'; onClick?: () => void; badge?: string }) {
  const toneStyle = tone === 'green'
    ? { background: '#d7ffb8', color: '#2b6c00' }
    : tone === 'blue'
      ? { background: '#dceeff', color: '#004666' }
      : { background: '#ffe9cc', color: '#683a00' };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-5 px-5 py-4 text-left bg-white transition-all duration-200 ${onClick ? 'cursor-pointer hover:bg-[#f9f9f9] hover:shadow-[inset_4px_0_0_#58cc02]' : 'cursor-default hover:bg-[#fdfdfd]'}`}
      style={{ borderBottom: '2px solid #f0f0f0' }}
      title={onClick ? undefined : 'Coming soon'}
    >
      <span className="flex items-center gap-3 min-w-0">
        <span className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0" style={{ background: toneStyle.background, color: toneStyle.color }}>
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-extrabold" style={{ color: '#1a1c1c' }}>{title}</span>
          <span className="block text-xs font-semibold" style={{ color: '#6f7b64' }}>{desc}</span>
        </span>
      </span>
      <span className="px-2 py-1 rounded-full text-[10px] font-extrabold shrink-0" style={{ background: toneStyle.background, color: toneStyle.color }}>
        {badge}
      </span>
    </button>
  );
}

function SideCard({ title, items, tone }: { title: string; items: string[]; tone: 'green' | 'blue' }) {
  const toneStyle = tone === 'green'
    ? { background: '#d7ffb8', color: '#2b6c00' }
    : { background: '#dceeff', color: '#004666' };

  return (
    <div className="rounded-3xl p-5" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
      <div className="inline-flex px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-widest mb-4" style={{ background: toneStyle.background, color: toneStyle.color }}>
        {title}
      </div>
      <div className="grid gap-3">
        {items.map((item, index) => (
          <p key={item} className="text-sm font-extrabold flex items-center justify-between" style={{ color: index === 0 ? '#1a1c1c' : '#6f7b64' }}>
            {item}
            {index === 0 && <span className="w-2 h-2 rounded-full" style={{ background: '#58cc02' }} />}
          </p>
        ))}
      </div>
    </div>
  );
}
