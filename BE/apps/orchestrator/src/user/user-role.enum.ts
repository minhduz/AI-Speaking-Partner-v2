// Application roles. Stored as a plain varchar on speaking_app.users.role to
// match the rest of the entity (level/status are varchars too — no Postgres
// enum type). Registration always assigns STUDENT; TEACHER/ADMIN are created
// by an admin (or the env-based AdminSeeder).
export enum UserRole {
  STUDENT = 'student',
  TEACHER = 'teacher',
  ADMIN = 'admin',
}

export const USER_ROLES = Object.values(UserRole);
