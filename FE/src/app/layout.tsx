import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Lexend } from 'next/font/google';
import { AuthProvider } from '@/contexts/auth-context';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const lexend = Lexend({ variable: '--font-lexend', subsets: ['latin'], weight: ['300', '400', '500', '600', '700', '800'] });

export const metadata: Metadata = {
  title: 'SpeakUP - AI Speaking Partner',
  description: 'Your personal AI language coach for real speaking practice, instant feedback, and steady progress.',
  manifest: '/manifest.json',
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
      <head>
        {/* PWA: Apple touch icon */}
        <link rel="apple-touch-icon" href="/icon-192.png" />
        {/* PWA: Safari pinned tab & splash */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="SpeakUP" />
      </head>
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
