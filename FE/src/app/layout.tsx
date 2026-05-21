import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Lexend } from 'next/font/google';
import { AuthProvider } from '@/contexts/auth-context';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const lexend = Lexend({ variable: '--font-lexend', subsets: ['latin'], weight: ['300', '400', '500', '600', '700', '800'] });

export const metadata: Metadata = {
  applicationName: 'SpeakUP',
  title: 'SpeakUP - AI Speaking Partner',
  description: 'Your personal AI language coach for real speaking practice, instant feedback, and steady progress.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SpeakUP',
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    title: 'SpeakUP - AI Speaking Partner',
    description: 'Real conversations, instant feedback, and steady progress with your AI language coach.',
  },
};

export const viewport: Viewport = {
  themeColor: '#58cc02',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${lexend.variable} h-full`} suppressHydrationWarning>
      <body className="h-full antialiased" suppressHydrationWarning>
        <AuthProvider>{children}</AuthProvider>
        {/* Service worker registration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function () {
                  navigator.serviceWorker.register('/sw.js').catch(function (err) {
                    console.warn('[SW] Registration failed:', err);
                  });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
