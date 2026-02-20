import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';

export function LoginButton() {
  const { login, error } = useAuth();

  const handleSuccess = (response: CredentialResponse) => {
    if (response.credential) {
      login(response.credential);
    }
  };

  const handleError = () => {
    console.error('Google login failed');
  };

  return (
    <div className="login-container">
      <h1>家計簿</h1>
      <p>ログインしてください</p>
      <GoogleLogin
        onSuccess={handleSuccess}
        onError={handleError}
      />
      {error && <p className="error-message">{error}</p>}
    </div>
  );
}
