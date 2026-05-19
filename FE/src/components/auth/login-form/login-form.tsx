'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertCircle, Loader2, Mail, Lock } from 'lucide-react';
import type { LoginFormProps } from './login-form.types';
import { GoogleSignInButton } from '@/components/shared/google-sign-in-button';

export function LoginForm({ onSubmit, onGoogleAuth, isLoading, error }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ email, password });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" style={{ fontFamily: 'Lexend, sans-serif' }}>
      {error && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl text-sm font-bold" style={{ background: '#ffe0e0', border: '2px solid #ffc6c6', color: '#9b1c1c' }}>
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <GoogleSignInButton onCredential={onGoogleAuth} text="signin_with" />

      <div className="flex items-center gap-3">
        <div className="flex-1 h-0.5" style={{ background: '#e2e2e2' }} />
        <span className="text-xs font-bold" style={{ color: '#6f7b64' }}>or sign in with email</span>
        <div className="flex-1 h-0.5" style={{ background: '#e2e2e2' }} />
      </div>

      <AuthField label="Email Address" icon={<Mail className="w-4 h-4" />}>
        <input
          id="login-email"
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm font-bold outline-none transition-all"
          style={{ background: '#fff', border: '2px solid #e2e2e2', color: '#1a1c1c' }}
        />
      </AuthField>

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center">
          <label htmlFor="login-password" className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Password</label>
          <Link href="/forgot-password" className="text-xs font-extrabold transition-colors hover:text-[#2b6c00]" style={{ color: '#58cc02' }}>
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: '#6f7b64' }} />
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm font-bold outline-none transition-all"
            style={{ background: '#fff', border: '2px solid #e2e2e2', color: '#1a1c1c' }}
          />
        </div>
      </div>

      <button
        id="login-submit"
        type="submit"
        disabled={isLoading}
        className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-black text-sm transition-all duration-200 hover:-translate-y-0.5 hover:brightness-[1.03] active:translate-y-1 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 mt-2"
        style={{ background: '#58cc02', color: '#1e5000', boxShadow: '0 4px 0 #46a302' }}
      >
        {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : 'Sign In'}
      </button>

      <div className="flex items-center justify-between px-4 py-3.5 rounded-2xl" style={{ background: '#fff', border: '2px solid #e2e2e2', boxShadow: '0 2px 0 #e2e2e2' }}>
        <p className="text-sm font-semibold" style={{ color: '#6f7b64' }}>New here?</p>
        <Link href="/register" className="text-sm font-black transition-colors hover:text-[#2b6c00]" style={{ color: '#58cc02' }}>
          Create an account →
        </Link>
      </div>
    </form>
  );
}

function AuthField({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>{label}</label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#6f7b64' }}>{icon}</span>
        {children}
      </div>
    </div>
  );
}
