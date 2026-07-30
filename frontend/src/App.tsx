import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import AppLayout from './components/layout/AppLayout';
import AuthGuard from './components/layout/AuthGuard';

const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const AgentsListPage = lazy(() => import('./pages/agents/AgentsListPage'));
const AgentFormPage = lazy(() => import('./pages/agents/AgentFormPage'));
const ClientsListPage = lazy(() => import('./pages/clients/ClientsListPage'));
const ClientFormPage = lazy(() => import('./pages/clients/ClientFormPage'));
const ScheduleManagerPage = lazy(() => import('./pages/schedules/ScheduleManagerPage'));
const ClockEntriesPage = lazy(() => import('./pages/clockEntries/ClockEntriesPage'));
const ExceptionsPage = lazy(() => import('./pages/exceptions/ExceptionsPage'));
const NormalizationPage = lazy(() => import('./pages/normalization/NormalizationPage'));
const PreSettlementsListPage = lazy(() => import('./pages/preSettlements/PreSettlementsListPage'));
const PreSettlementDetailPage = lazy(() => import('./pages/preSettlements/PreSettlementDetailPage'));

function Loading() {
  return (
    <div className="flex items-center justify-center p-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <AuthGuard>
                <AppLayout />
              </AuthGuard>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/agents" element={<AgentsListPage />} />
            <Route path="/agents/new" element={<AgentFormPage />} />
            <Route path="/agents/:id" element={<AgentFormPage />} />
            <Route path="/clients" element={<ClientsListPage />} />
            <Route path="/clients/new" element={<ClientFormPage />} />
            <Route path="/clients/:id" element={<ClientFormPage />} />
            <Route path="/schedules" element={<ScheduleManagerPage />} />
            <Route path="/clock-entries" element={<ClockEntriesPage />} />
            <Route path="/exceptions" element={<ExceptionsPage />} />
            <Route path="/normalization" element={<NormalizationPage />} />
            <Route path="/pre-settlements" element={<PreSettlementsListPage />} />
            <Route path="/pre-settlements/:id" element={<PreSettlementDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
