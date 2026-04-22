import { useAuthStore } from '../stores/authStore';
import { shallow } from 'zustand/shallow';

export function useAuth() {
  const { user, isAuthenticated, login, register, logout, refresh } = useAuthStore(
    (s) => ({ user: s.user, isAuthenticated: s.isAuthenticated, login: s.login, register: s.register, logout: s.logout, refresh: s.refresh }),
    shallow,
  );
  return { user, isAuthenticated, login, register, logout, refresh };
}
