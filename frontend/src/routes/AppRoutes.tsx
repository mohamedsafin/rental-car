/**
 * routes/AppRoutes.tsx
 * ---------------------------------------------------------------------------
 * The site map. Public routes sit directly under the layout; anything that
 * needs a signed-in user is nested inside <ProtectedRoute />, which is a
 * convenience for honest users - the backend is what enforces access.
 */
import { Route, Routes } from 'react-router-dom';
import PublicLayout from '../layouts/PublicLayout';
import ProtectedRoute from '../components/ProtectedRoute';
import HomePage from '../pages/HomePage';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import AccountPage from '../pages/AccountPage';
import NotFoundPage from '../pages/NotFoundPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        {/* Public */}
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Signed-in customers only */}
        <Route element={<ProtectedRoute />}>
          <Route path="/account" element={<AccountPage />} />
          {/* Phase 5+: /account/documents, /account/bookings, /account/invoices */}
        </Route>

        {/* Phase 3+: /cars, /cars/:id, /booking, /checkout, /faq, /terms */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
