import { Logo } from '@/components/shared/logo/logo';
import { RegisterFormContainer } from './register-form-container';

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 bg-[#F5F2EA]">
      <div className="mb-8 text-center">
        <Logo size="md" />
        <p className="text-gray-500 text-sm mt-2">Begin your language journey.</p>
      </div>

      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-[#F0EDE7] px-8 py-8">
        <RegisterFormContainer />
      </div>
    </div>
  );
}
