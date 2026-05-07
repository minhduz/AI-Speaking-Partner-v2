import { Logo } from '@/components/shared/logo/logo';
import { LoginFormContainer } from './login-form-container';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      <div
        className="hidden lg:block lg:w-1/2 relative"
        style={{ background: 'linear-gradient(145deg, #6b7c5e 0%, #8fa07e 30%, #c8cfc0 60%, #7a8c6e 100%)' }}
      />

      <div className="flex flex-1 flex-col justify-center px-8 py-12 lg:px-16 bg-[#F5F2EA]">
        <div className="w-full max-w-md mx-auto">
          <div className="mb-10">
            <Logo />
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome back</h1>
            <p className="text-gray-500 text-sm">Sign in to continue your linguistic journey.</p>
          </div>

          <LoginFormContainer />
        </div>
      </div>
    </div>
  );
}
