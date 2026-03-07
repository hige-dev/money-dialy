import { useGoogleOneTapLogin, type CredentialResponse } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';

export function LoginButton() {
  const { login, error } = useAuth();

  useGoogleOneTapLogin({
    onSuccess: (response: CredentialResponse) => {
      if (response.credential) {
        login(response.credential);
      }
    },
    onError: () => {
      console.error('Google One Tap login failed');
    },
    cancel_on_tap_outside: false,
    auto_select: true,
  });

  return (
    <div className="login-container">
      <h1>家計簿</h1>
      <p>Google アカウントでログインしてください</p>
      {error && <p className="error-message">{error}</p>}
    </div>
  );
}
