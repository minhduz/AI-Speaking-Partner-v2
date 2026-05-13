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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-500">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Google Sign-In */}
      <GoogleSignInButton onCredential={onGoogleAuth} text="signin_with" />

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-100" />
        <span className="text-xs text-gray-400">or sign in with email</span>
        <div className="flex-1 h-px bg-gray-100" />
      </div>

      {/* Email */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-email" className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
          Email Address
        </label>
        <div className="relative">
          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
          <input
            id="login-email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full pl-10 pr-4 py-3.5 rounded-2xl border border-gray-200 bg-gray-50 text-sm text-gray-800 placeholder:text-gray-300 outline-none focus:border-[#8447FF] focus:bg-white focus:ring-2 focus:ring-[#8447FF]/10 transition-all"
          />
        </div>
      </div>

      {/* Password */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center">
          <label htmlFor="login-password" className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-xs text-[#8447FF] hover:text-[#7C3AED] transition-colors font-semibold"
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full pl-10 pr-4 py-3.5 rounded-2xl border border-gray-200 bg-gray-50 text-sm text-gray-800 outline-none focus:border-[#8447FF] focus:bg-white focus:ring-2 focus:ring-[#8447FF]/10 transition-all"
          />
        </div>
      </div>

      {/* Submit */}
      <button
        id="login-submit"
        type="submit"
        disabled={isLoading}
        className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl bg-[#8447FF] text-white font-bold text-sm hover:bg-[#7C3AED] active:scale-[0.98] transition-all shadow-md disabled:opacity-60 disabled:cursor-not-allowed mt-2"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Signing in…
          </>
        ) : (
          'Sign In'
        )}
      </button>

      {/* Register CTA */}
      <div className="flex items-center justify-between px-4 py-3.5 rounded-2xl bg-gray-50 border border-gray-100">
        <p className="text-sm text-gray-500">New here?</p>
        <Link
          href="/register"
          className="text-sm text-[#8447FF] font-bold hover:text-[#7C3AED] transition-colors"
        >
          Create an account →
        </Link>
      </div>
    </form>
  );
}
