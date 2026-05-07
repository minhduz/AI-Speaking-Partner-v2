import Link from 'next/link';
import { Logo } from '@/components/shared/logo/logo';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#F5F2EA] flex flex-col items-center justify-center px-4">
      <div className="mb-10">
        <Logo />
      </div>

      <p className="text-[120px] font-bold text-[#4A6741] leading-none select-none opacity-20">
        404
      </p>

      <h1 className="text-2xl font-bold text-gray-900 mt-4">Page not found</h1>
      <p className="text-gray-500 text-sm mt-2 text-center max-w-xs">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>

      <Link
        href="/chat"
        className="mt-8 px-6 py-3 rounded-xl bg-[#4A6741] text-white text-sm font-medium hover:bg-[#3D5535] transition-colors"
      >
        Back to chat
      </Link>
    </div>
  );
}
