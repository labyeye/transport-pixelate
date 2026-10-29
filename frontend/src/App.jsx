import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ToastProvider } from "@/hooks/use-toast";
import AuthPage from "@/pages/AuthPage";
import RegisterPage from "@/pages/RegisterPage";
import OnboardingPage from "@/pages/OnboardingPage";
import WelcomePage from "@/pages/WelcomePage";
import DashboardPage from "@/pages/DashboardPage";
import VehiclesPage from "@/pages/VehiclesPage";
import PassengersPage from "@/pages/PassengersPage";
import TrackingPage from "@/pages/TrackingPage";
import MaintenancePage from "@/pages/MaintenancePage";
import FuelExpensesPage from "@/pages/FuelExpensesPage";
import DocumentsPage from "@/pages/DocumentsPage";
import NotificationsPage from "@/pages/NotificationsPage";
import RequestsPage from "@/pages/RequestsPage";
import ReportsPage from "@/pages/ReportsPage";
import SettingsPage from "@/pages/SettingsPage";
import { ForgotPasswordPage, ResetPasswordPage } from "@/pages/PasswordPages";
import BillingPage from "@/pages/BillingPage";
import TripsPage from "@/pages/TripsPage";
import RoutesPage from "@/pages/RoutesPage";
import DriversPage from "@/pages/DriversPage";
import SubscriptionPage from "@/pages/SubscriptionPage";
import AlertsPage from "@/pages/AlertsPage";
import CreditsPage from "@/pages/CreditsPage";
import { CreditsProvider } from "@/contexts/CreditsContext";
const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#024BAB] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  // Self-service sign-ups finish the company / fleet / plan wizard before using the app.
  if (!user.onboarded) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function AuthedOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}
export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <AuthProvider>
          <CreditsProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<AuthPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route
                path="/onboarding"
                element={
                  <AuthedOnly>
                    <OnboardingPage />
                  </AuthedOnly>
                }
              />
              <Route
                path="/welcome"
                element={
                  <AuthedOnly>
                    <WelcomePage />
                  </AuthedOnly>
                }
              />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route
                path="/"
                element={
                  <Protected>
                    <DashboardPage />
                  </Protected>
                }
              />
              <Route
                path="/vehicles"
                element={
                  <Protected>
                    <VehiclesPage />
                  </Protected>
                }
              />
              <Route
                path="/drivers"
                element={
                  <Protected>
                    <DriversPage />
                  </Protected>
                }
              />
              <Route
                path="/routes"
                element={
                  <Protected>
                    <RoutesPage />
                  </Protected>
                }
              />
              <Route
                path="/trips"
                element={
                  <Protected>
                    <TripsPage />
                  </Protected>
                }
              />
              <Route
                path="/passengers"
                element={
                  <Protected>
                    <PassengersPage />
                  </Protected>
                }
              />
              <Route
                path="/tracking"
                element={
                  <Protected>
                    <TrackingPage />
                  </Protected>
                }
              />
              <Route
                path="/maintenance"
                element={
                  <Protected>
                    <MaintenancePage />
                  </Protected>
                }
              />
              <Route
                path="/fuel-expenses"
                element={
                  <Protected>
                    <FuelExpensesPage />
                  </Protected>
                }
              />
              <Route
                path="/documents"
                element={
                  <Protected>
                    <DocumentsPage />
                  </Protected>
                }
              />
              <Route
                path="/notifications"
                element={
                  <Protected>
                    <NotificationsPage />
                  </Protected>
                }
              />
              <Route
                path="/requests"
                element={
                  <Protected>
                    <RequestsPage />
                  </Protected>
                }
              />
              <Route
                path="/reports"
                element={
                  <Protected>
                    <ReportsPage />
                  </Protected>
                }
              />
              <Route
                path="/settings"
                element={
                  <Protected>
                    <SettingsPage />
                  </Protected>
                }
              />
              <Route
                path="/alerts"
                element={
                  <Protected>
                    <AlertsPage />
                  </Protected>
                }
              />
              <Route
                path="/subscription"
                element={
                  <Protected>
                    <SubscriptionPage />
                  </Protected>
                }
              />
              <Route
                path="/billing"
                element={
                  <Protected>
                    <BillingPage />
                  </Protected>
                }
              />
              <Route
                path="/credits"
                element={
                  <Protected>
                    <CreditsPage />
                  </Protected>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
          </CreditsProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
