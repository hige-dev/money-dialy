import { useGoogleOneTapLogin, GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';

export function LoginButton() {
  const { login, error } = useAuth();

  const handleSuccess = (response: CredentialResponse) => {
    if (response.credential) {
      login(response.credential);
    }
  };

  useGoogleOneTapLogin({
    onSuccess: handleSuccess,
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
      <GoogleLogin
        onSuccess={handleSuccess}
        onError={() => console.error('Google login failed')}
        size="large"
        width="300"
        text="signin_with"
      />
      {error && <p className="error-message">{error}</p>}
    </div>
  );
}
