'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ProficiencyLevel, RegisterFormProps } from './register-form.types';
import { LANGUAGES } from './register-form.types';

const LEVELS: { value: ProficiencyLevel; label: string; index: number }[] = [
  { value: 'beginner', label: 'Beginner', index: 1 },
  { value: 'intermediate', label: 'Intermediate', index: 2 },
  { value: 'advanced', label: 'Advanced', index: 3 },
];

export function RegisterForm({ onSubmit, isLoading, error }: RegisterFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [language, setLanguage] = useState('');
  const [level, setLevel] = useState<ProficiencyLevel | ''>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!language || !level) return;
    onSubmit({ name, email, password, target_language: language, level });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-gray-700">Full Name</label>
        <input
          type="text"
          placeholder="John Doe"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="px-4 py-3 rounded-xl border border-[#E5E0D8] bg-white text-sm text-gray-800 placeholder:text-gray-300 outline-none focus:border-[#4A6741] transition-colors"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-gray-700">Email Address</label>
        <input
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="px-4 py-3 rounded-xl border border-[#E5E0D8] bg-white text-sm text-gray-800 placeholder:text-gray-300 outline-none focus:border-[#4A6741] transition-colors"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-gray-700">Password</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full px-4 py-3 pr-11 rounded-xl border border-[#E5E0D8] bg-white text-sm text-gray-800 outline-none focus:border-[#4A6741] transition-colors"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        <p className="text-xs text-gray-400">Must be at least 8 characters.</p>
      </div>

      <hr className="border-[#E5E0D8]" />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-gray-700">Target Language</label>
        <div className="relative">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-xl border border-[#E5E0D8] bg-white text-sm text-gray-800 appearance-none outline-none focus:border-[#4A6741] transition-colors cursor-pointer"
          >
            <option value="" disabled>
              Select a language to learn
            </option>
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
            <ChevronDownIcon />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">Current Proficiency Level</label>
        <div className="grid grid-cols-3 gap-3">
          {LEVELS.map(({ value, label, index }) => (
            <button
              key={value}
              type="button"
              onClick={() => setLevel(value)}
              className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-sm font-medium transition-colors ${
                level === value
                  ? 'border-[#4A6741] bg-[#4A6741]/5 text-[#4A6741]'
                  : 'border-[#E5E0D8] text-gray-600 hover:border-[#4A6741]/40'
              }`}
            >
              <span className="flex items-center justify-center w-7 h-7 rounded border border-current text-xs font-bold">
                {index}
              </span>
              {label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading || !language || !level}
        className="flex items-center justify-center gap-2 w-full py-3.5 px-6 rounded-xl bg-[#4A6741] text-white font-medium text-sm hover:bg-[#3D5535] transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-1"
      >
        {isLoading ? 'Creating account…' : <>Create Account <span aria-hidden>→</span></>}
      </button>

      <p className="text-center text-sm text-gray-500">
        Already have an account?{' '}
        <Link href="/login" className="text-[#4A6741] font-medium hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
