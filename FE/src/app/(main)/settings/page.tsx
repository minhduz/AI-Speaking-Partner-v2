'use client';

import { useAuthContext } from '@/contexts/auth-context';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { SettingsPanel } from '@/components/chat/settings-modal/settings-modal';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const { logout } = useAuthContext();
  const router = useRouter();

  return (
    <div className="flex w-full h-full">
      <Sidebar
        onNewChat={() => router.push('/chat')}
        onLogout={logout}
        currentSessionId={null}
        onSessionClick={(session) => router.push(`/chat?sessionId=${session.id}`)}
      />
      <main className="flex-1 flex flex-col h-full overflow-hidden" style={{ background: '#f9f9f9', fontFamily: 'Lexend, sans-serif' }}>
        <header className="flex items-center justify-between px-10 h-20 shrink-0 sticky top-0 z-40" style={{ background: '#f9f9f9' }}>
          <div>
            <h1 className="text-2xl font-black" style={{ color: '#2b6c00', letterSpacing: '-0.01em' }}>
              Settings
            </h1>
          </div>
        </header>

        <div className="flex-1 overflow-hidden px-8 pb-8">
          <div className="h-full max-w-6xl mx-auto">
            <SettingsPanel />
          </div>
        </div>
      </main>
    </div>
  );
}
