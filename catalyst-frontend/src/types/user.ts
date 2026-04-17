export type Role = 'admin' | 'user';

export interface User {
  id: string;
  email: string;
  username: string;
  role: Role;
  permissions?: string[];
  twoFactorEnabled?: boolean;
  image?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
}
