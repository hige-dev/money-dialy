import type { Config } from './types';

// ローカル専用モードは開発サーバーでのみ有効。
export const isLocalBackend = import.meta.env.DEV && import.meta.env.MODE === 'offline';

export const config: Config = {
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  apiUrl: isLocalBackend ? '/api' : import.meta.env.VITE_API_URL || '',
  allowedEmails: (import.meta.env.VITE_ALLOWED_EMAILS || '').split(',').filter(Boolean),
};

/**
 * メールアドレスが許可リストに含まれているか確認
 */
export function isAllowedEmail(email: string): boolean {
  if (config.allowedEmails.length === 0) {
    // 許可リスト未設定の場合、バックエンドのusersシートで制御
    return true;
  }
  return config.allowedEmails.includes(email);
}
