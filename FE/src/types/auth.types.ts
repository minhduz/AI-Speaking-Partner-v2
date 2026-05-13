export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  target_language: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  native_language: string;
  learning_goal: string;
  timezone: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  target_language: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  native_language: string;
  learning_goal: string;
}
