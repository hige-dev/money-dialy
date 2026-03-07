import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider, useGoogleOneTapLogin, type CredentialResponse } from '@react-oauth/google';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginButton } from './components/LoginButton';
import { LoadingSpinner } from './components/LoadingSpinner';
import { BottomNav } from './components/BottomNav';
import { ExpenseInputPage } from './pages/ExpenseInputPage';
import { SummaryPage } from './pages/SummaryPage';
import { CalendarPage } from './pages/CalendarPage';
import { RecurringPage } from './pages/RecurringPage';
import { SettingsPage } from './pages/SettingsPage';
import { BalancePage } from './pages/BalancePage';
import { BulkExpensePage } from './pages/BulkExpensePage';
import { config } from './config';
import './App.css';

const TOKEN_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7日

function isTokenStale(): boolean {
  const loginTime = localStorage.getItem('money_diary_login_time');
  if (!loginTime) return true;
  return Date.now() - Number(loginTime) >= TOKEN_REFRESH_THRESHOLD_MS;
}

function TokenRefresher() {
  const { login } = useAuth();
  const needsRefresh = isTokenStale();

  useGoogleOneTapLogin({
    onSuccess: (response: CredentialResponse) => {
      if (response.credential) {
        login(response.credential);
      }
    },
    onError: () => {},
    auto_select: true,
    disabled: !needsRefresh,
  });

  return null;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSpinner message="認証状態を確認中..." />;
  }

  if (!user) {
    return <LoginButton />;
  }

  return (
    <>
      <TokenRefresher />
      {children}
    </>
  );
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <ProtectedRoute>
      <div className="app-layout">
        <main className="main-content">
          <Routes>
            <Route path="/" element={<SummaryPage />} />
            <Route path="/input" element={<ExpenseInputPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/list" element={<Navigate to="/calendar" replace />} />
            <Route path="/recurring" element={<AdminRoute><RecurringPage /></AdminRoute>} />
            <Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
            <Route path="/balance" element={<AdminRoute><BalancePage /></AdminRoute>} />
            <Route path="/bulk" element={<AdminRoute><BulkExpensePage /></AdminRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <BottomNav />
      </div>
    </ProtectedRoute>
  );
}

function App() {
  return (
    <GoogleOAuthProvider clientId={config.googleClientId}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}

export default App;
