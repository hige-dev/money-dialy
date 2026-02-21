import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginButton } from './components/LoginButton';
import { LoadingSpinner } from './components/LoadingSpinner';
import { BottomNav } from './components/BottomNav';
import { ExpenseInputPage } from './pages/ExpenseInputPage';
import { ExpenseListPage } from './pages/ExpenseListPage';
import { SummaryPage } from './pages/SummaryPage';
import { CalendarPage } from './pages/CalendarPage';
import { RecurringPage } from './pages/RecurringPage';
import { SettingsPage } from './pages/SettingsPage';
import { BalancePage } from './pages/BalancePage';
import { config } from './config';
import './App.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSpinner message="認証状態を確認中..." />;
  }

  if (!user) {
    return <LoginButton />;
  }

  return <>{children}</>;
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
            <Route path="/list" element={<ExpenseListPage />} />
            <Route path="/recurring" element={<AdminRoute><RecurringPage /></AdminRoute>} />
            <Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
            <Route path="/balance" element={<AdminRoute><BalancePage /></AdminRoute>} />
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
