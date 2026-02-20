import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { User, Role } from '../types';
import { isAllowedEmail } from '../config';
import { setAuthToken, usersApi } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  login: (credential: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY = 'money_diary_auth_user';
const TOKEN_KEY = 'money_diary_auth_token';
const LOGIN_TIME_KEY = 'money_diary_login_time';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30日

interface AuthProviderProps {
  children: ReactNode;
}

function isSessionExpired(): boolean {
  try {
    const loginTime = localStorage.getItem(LOGIN_TIME_KEY);
    if (!loginTime) return true;
    return Date.now() - Number(loginTime) >= SESSION_MAX_AGE_MS;
  } catch {
    return true;
  }
}

async function fetchRole(): Promise<Role> {
  try {
    return await usersApi.getMyRole();
  } catch {
    return 'user';
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const storedUser = localStorage.getItem(STORAGE_KEY);
        const storedToken = localStorage.getItem(TOKEN_KEY);

        if (storedUser && storedToken) {
          if (isSessionExpired()) {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(LOGIN_TIME_KEY);
            setAuthToken(null);
          } else {
            setAuthToken(storedToken);
            const role = await fetchRole();
            const restored = { ...(JSON.parse(storedUser) as User), role };
            setUser(restored);
            setToken(storedToken);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
          }
        } else {
          setAuthToken(null);
        }
      } catch (e) {
        console.error('Failed to restore auth state:', e);
        setAuthToken(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (credential: string) => {
    setError(null);
    try {
      const payload = JSON.parse(atob(credential.split('.')[1]));

      const email = payload.email as string;
      const name = payload.name as string;
      const picture = payload.picture as string | undefined;

      if (!isAllowedEmail(email)) {
        setError('このメールアドレスからのログインは許可されていません。');
        return;
      }

      setAuthToken(credential);
      const role = await fetchRole();
      const newUser: User = { email, name, picture, role };
      setUser(newUser);
      setToken(credential);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newUser));
      localStorage.setItem(TOKEN_KEY, credential);
      localStorage.setItem(LOGIN_TIME_KEY, String(Date.now()));
    } catch (e) {
      console.error('Login failed:', e);
      setError('ログインに失敗しました。');
    }
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    setToken(null);
    setError(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LOGIN_TIME_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
