/**
 * routes/AppRoutes.tsx
 * ---------------------------------------------------------------------------
 * Admin route map. From Phase 2, everything below AdminLayout sits behind a
 * ProtectedRoute wrapper that checks the logged-in user's role.
 */
import { Route, Routes } from 'react-router-dom';
import AdminLayout from '../layouts/AdminLayout';
import DashboardPage from '../pages/DashboardPage';
import NotFoundPage from '../pages/NotFoundPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route path="/" element={<DashboardPage />} />
        {/* Phase 2+: /login, /vehicles, /bookings, /customers, /documents,
            /payments, /reports, /settings ... */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
