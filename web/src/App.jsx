import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ToastProvider } from "@/hooks/use-toast";
import AuthPage from "@/pages/AuthPage";
import DashboardPage from "@/pages/DashboardPage";
import VehiclesPage from "@/pages/VehiclesPage";
import PassengersPage from "@/pages/PassengersPage";
import TripsPage from "@/pages/TripsPage";
import RoutesPage from "@/pages/RoutesPage";
import DriversPage from "@/pages/DriversPage";
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
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}
export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<AuthPage />} />
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
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
