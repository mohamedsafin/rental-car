/**
 * routes/AppRoutes.tsx
 * ---------------------------------------------------------------------------
 * Admin route map.
 *
 * /login is the only public route. Everything else sits inside
 * <ProtectedRoute allowedRoles={['ADMIN', 'STAFF']} />, which redirects a
 * signed-out visitor to login and shows an "access denied" panel to a signed-in
 * CUSTOMER. Both behaviours are for honest users - the backend refuses these
 * endpoints regardless of what this file allows.
 */
import { Route, Routes } from 'react-router-dom';
import AdminLayout from '../layouts/AdminLayout';
import ProtectedRoute from '../components/ProtectedRoute';
import LoginPage from '../pages/LoginPage';
import DashboardPage from '../pages/DashboardPage';
import UsersPage from '../pages/UsersPage';
import NotFoundPage from '../pages/NotFoundPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute allowedRoles={['ADMIN', 'STAFF']} />}>
        <Route element={<AdminLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/users" element={<UsersPage />} />
          {/* Phase 3+: /vehicles, /bookings, /customers, /documents,
              /payments, /reports, /settings */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
