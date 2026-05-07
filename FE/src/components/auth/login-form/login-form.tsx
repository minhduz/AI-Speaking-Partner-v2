'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { LoginFormProps } from './login-form.types';

export function LoginForm({ onSubmit, isLoading, error }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ email, password });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-semibold tracking-[0.12em] text-gray-400 uppercase">
          Email Address
        </label>
        <input
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="px-4 py-3.5 rounded-xl border border-[#E5E0D8] bg-white text-sm text-gray-800 placeholder:text-gray-300 outline-none focus:border-[#4A6741] transition-colors"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center">
          <label className="text-[10px] font-semibold tracking-[0.12em] text-gray-400 uppercase">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Forgot password?
          </Link>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="px-4 py-3.5 rounded-xl border border-[#E5E0D8] bg-white text-sm text-gray-800 outline-none focus:border-[#4A6741] transition-colors"
        />
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="flex items-center justify-center gap-2 w-full py-3.5 px-6 rounded-xl bg-[#4A6741] text-white font-medium text-sm hover:bg-[#3D5535] transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-1"
      >
        {isLoading ? 'Signing in…' : <>Sign In <span aria-hidden>→</span></>}
      </button>

      <p className="text-center text-sm text-gray-500">
        Don&apos;t have an account?{' '}
        <Link href="/register" className="text-[#4A6741] font-medium hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
