'use client';

import { useAuthContext } from '@/contexts/auth-context';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { SettingsPanel } from '@/components/chat/settings-modal/settings-modal';
import { PageHeader } from '@/components/shared/page-header';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const { logout } = useAuthContext();
  const router = useRouter();

  return (
    <div className="flex w-full h-full min-w-0">
      <Sidebar
        onNewChat={() => router.push('/chat')}
        onLogout={logout}
        currentSessionId={null}
        onSessionClick={(session) => router.push(`/chat?sessionId=${session.id}`)}
      />

      <main
        className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden"
        style={{ background: '#f9f9f9', fontFamily: 'Lexend, sans-serif' }}
      >
        <PageHeader title="Settings" />

        {/* Scrollable content accounts for mobile bottom nav */}
        <div className="flex-1 overflow-y-auto px-2 pb-24 sm:px-8 lg:overflow-hidden lg:pb-0">
          <div className="w-full max-w-6xl mx-auto py-3 sm:py-4">
            <SettingsPanel />
          </div>
        </div>
      </main>
    </div>
  );
}
