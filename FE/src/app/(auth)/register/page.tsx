import { Suspense } from 'react';
import { RegisterFormContainer } from './register-form-container';

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterFormContainer />
    </Suspense>
  );
}
