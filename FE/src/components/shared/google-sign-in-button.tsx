'use client';

import { useEffect, useRef, useCallback } from 'react';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (el: HTMLElement, config: Record<string, unknown>) => void;
          prompt: () => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

interface GoogleSignInButtonProps {
  onCredential: (credential: string) => void;
  text?: 'signin_with' | 'signup_with' | 'continue_with';
  width?: number;
}

export function GoogleSignInButton({ onCredential, text = 'continue_with', width }: GoogleSignInButtonProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);
  const initializedRef = useRef(false);
  callbackRef.current = onCredential;

  const initGoogle = useCallback(() => {
    if (!window.google || !btnRef.current || !wrapperRef.current || initializedRef.current) return;

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      console.error('[GoogleSignIn] NEXT_PUBLIC_GOOGLE_CLIENT_ID not set');
      return;
    }

    // Auto-detect container width if not explicitly passed
    const resolvedWidth = (width ?? Math.floor(wrapperRef.current.getBoundingClientRect().width)) || 360;

    initializedRef.current = true;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response: { credential: string }) => {
        callbackRef.current(response.credential);
      },
    });

    window.google.accounts.id.renderButton(btnRef.current, {
      type: 'standard',
      shape: 'pill',
      theme: 'outline',
      size: 'large',
      text,
      width: Math.min(resolvedWidth, 400),
      logo_alignment: 'left',
    });
  }, [text, width]);

  useEffect(() => {
    if (window.google) {
      initGoogle();
      return;
    }

    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', initGoogle);
      return () => existing.removeEventListener('load', initGoogle);
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    document.head.appendChild(script);
  }, [initGoogle]);

  return (
    <div ref={wrapperRef} className="w-full flex justify-center" style={{ position: 'relative', zIndex: 1 }}>
      <div ref={btnRef} />
    </div>
  );
}
