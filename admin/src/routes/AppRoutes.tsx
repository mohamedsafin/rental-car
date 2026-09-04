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
import VehiclesPage from '../pages/VehiclesPage';
import VehicleFormPage from '../pages/VehicleFormPage';
import LocationsPage from '../pages/LocationsPage';
import PricingPage from '../pages/PricingPage';
import CustomersPage from '../pages/CustomersPage';
import BookingsPage from '../pages/BookingsPage';
import AdminBookingDetailPage from '../pages/BookingDetailPage';
import CustomerDetailPage from '../pages/CustomerDetailPage';
import NotFoundPage from '../pages/NotFoundPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute allowedRoles={['ADMIN', 'STAFF']} />}>
        <Route element={<AdminLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/vehicles/new" element={<VehicleFormPage />} />
          <Route path="/vehicles/:id" element={<VehicleFormPage />} />
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/bookings/:id" element={<AdminBookingDetailPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route path="/users" element={<UsersPage />} />
          {/* Phase 5+: /customers, /documents. Phase 6+: /bookings.
              Phase 7+: /payments. Phase 10+: /reports, /settings */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
