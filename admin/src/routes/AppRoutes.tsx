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
import PasswordRecoveryPage from '../pages/PasswordRecoveryPage';
import DashboardPage from '../pages/DashboardPage';
import PaymentsPage from '../pages/PaymentsPage';
import DepositsPage from '../pages/DepositsPage';
import UsersPage from '../pages/UsersPage';
import VehiclesPage from '../pages/VehiclesPage';
import VehicleFormPage from '../pages/VehicleFormPage';
import LocationsPage from '../pages/LocationsPage';
import PricingPage from '../pages/PricingPage';
import CustomersPage from '../pages/CustomersPage';
import BookingsPage from '../pages/BookingsPage';
import NewBookingPage from '../pages/NewBookingPage';
import CalendarPage from '../pages/CalendarPage';
import AdminBookingDetailPage from '../pages/BookingDetailPage';
import CustomerDetailPage from '../pages/CustomerDetailPage';
import MaintenancePage from '../pages/MaintenancePage';
import DamagesPage from '../pages/DamagesPage';
import AccidentsPage from '../pages/AccidentsPage';
import FinesPage from '../pages/FinesPage';
import ExpiryPage from '../pages/ExpiryPage';
import ReportsPage from '../pages/ReportsPage';
import CouponsPage from '../pages/CouponsPage';
import InvoicesPage from '../pages/InvoicesPage';
import NotificationsPage from '../pages/NotificationsPage';
import LegalPage from '../pages/LegalPage';
import CategoriesPage from '../pages/CategoriesPage';
import PickupsPage from '../pages/PickupsPage';
import ReturnsPage from '../pages/ReturnsPage';
import InspectionsPage from '../pages/InspectionsPage';
import SettingsPage from '../pages/SettingsPage';
import AuditLogPage from '../pages/AuditLogPage';
import NotFoundPage from '../pages/NotFoundPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/*
        Public, and they have to be: somebody who cannot sign in is exactly
        who needs them, and an emailed link opens in a browser with no session.
        One component serves both halves - which it shows depends on whether
        the URL carries a token.
      */}
      <Route path="/forgot-password" element={<PasswordRecoveryPage />} />
      <Route path="/reset-password" element={<PasswordRecoveryPage />} />

      <Route element={<ProtectedRoute allowedRoles={['ADMIN', 'STAFF']} />}>
        <Route element={<AdminLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/vehicles/new" element={<VehicleFormPage />} />
          <Route path="/vehicles/:id" element={<VehicleFormPage />} />
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/bookings/new" element={<NewBookingPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/bookings/:id" element={<AdminBookingDetailPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/maintenance" element={<MaintenancePage />} />
          <Route path="/insurance" element={<ExpiryPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/deposits" element={<DepositsPage />} />
          <Route path="/damages" element={<DamagesPage />} />
          <Route path="/accidents" element={<AccidentsPage />} />
          <Route path="/fines" element={<FinesPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/coupons" element={<CouponsPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/legal" element={<LegalPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/pickups" element={<PickupsPage />} />
          <Route path="/returns" element={<ReturnsPage />} />
          <Route path="/inspections" element={<InspectionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
