/**
 * modules/health/routes.ts
 * ---------------------------------------------------------------------------
 * URL -> controller wiring only. Route files stay declarative: no logic here,
 * ever. From Phase 2, auth/RBAC/validation middleware slots in on these lines.
 */
import { Router } from 'express';
import { healthController } from './controller';

const router = Router();

// GET /api/v1/health/live  — liveness probe (no database access)
router.get('/live', healthController.live);

// GET /api/v1/health       — readiness probe (checks PostgreSQL)
router.get('/', healthController.health);

export const healthRoutes = router;
