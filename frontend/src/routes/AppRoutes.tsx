/**
 * routes/AppRoutes.tsx
 * ---------------------------------------------------------------------------
 * The single place that maps URLs to pages. Keeping routes here (rather than
 * scattered across components) makes the whole site map readable at a glance,
 * and gives us one obvious place to add protected routes in Phase 2.
 */
import { Route, Routes } from 'react-router-dom';
import PublicLayout from '../layouts/PublicLayout';
import HomePage from '../pages/HomePage';
import NotFoundPage from '../pages/NotFoundPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        {/* Phase 3+: /cars, /cars/:id, /booking, /checkout, /login, /register,
            /dashboard, /faq, /terms, /privacy ... */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
