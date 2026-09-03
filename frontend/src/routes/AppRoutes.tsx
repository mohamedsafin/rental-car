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
import CarsPage from '../pages/CarsPage';
import CarDetailsPage from '../pages/CarDetailsPage';
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
        <Route path="/cars" element={<CarsPage />} />
        <Route path="/cars/:id" element={<CarDetailsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Signed-in customers only */}
        <Route element={<ProtectedRoute />}>
          <Route path="/account" element={<AccountPage />} />
          {/* Phase 5+: /account/documents, /account/bookings, /account/invoices */}
        </Route>

        {/* Phase 6+: /booking, /checkout. Phase 10+: /faq, /terms */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
