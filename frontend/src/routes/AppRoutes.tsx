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
import SearchResultsPage from '../pages/SearchResultsPage';
import CarDetailsPage from '../pages/CarDetailsPage';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import AccountPage from '../pages/AccountPage';
import DocumentsPage from '../pages/DocumentsPage';
import MyBookingsPage from '../pages/MyBookingsPage';
import BookingDetailPage from '../pages/BookingDetailPage';
import NotFoundPage from '../pages/NotFoundPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        {/* Public */}
        <Route path="/" element={<HomePage />} />
        <Route path="/cars" element={<CarsPage />} />
        <Route path="/search" element={<SearchResultsPage />} />
        <Route path="/cars/:id" element={<CarDetailsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Signed-in customers only */}
        <Route element={<ProtectedRoute />}>
          <Route path="/account" element={<AccountPage />} />
          <Route path="/account/documents" element={<DocumentsPage />} />
          <Route path="/account/bookings" element={<MyBookingsPage />} />
          <Route path="/account/bookings/:id" element={<BookingDetailPage />} />
          {/* Phase 10+: /account/invoices */}
        </Route>

        {/* Phase 6+: /booking, /checkout. Phase 10+: /faq, /terms */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
