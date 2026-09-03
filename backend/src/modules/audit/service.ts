/**
 * modules/audit/service.ts
 * ---------------------------------------------------------------------------
 * Writes the audit trail required by BRD 46.
 *
 * Two design rules:
 *
 *  1. NEVER let an audit failure break the business action. If the log write
 *     throws, we log the problem and carry on - a customer's booking must not
 *     fail because an audit row could not be inserted.
 *
 *  2. Never put secrets in `metadata`. Passwords, tokens and card data must not
 *     end up here. Audit logs are widely readable inside a company and are
 *     exactly the sort of table that gets exported to a spreadsheet.
 */
import type { Prisma, Role } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';

export const AuditAction = {
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILED: 'auth.login.failed',
  LOGIN_LOCKED: 'auth.login.locked',
  LOGOUT: 'auth.logout',
  REGISTER: 'auth.register',
  TOKEN_REFRESHED: 'auth.token.refreshed',
  TOKEN_REUSE_DETECTED: 'auth.token.reuse_detected',
  PASSWORD_CHANGED: 'auth.password.changed',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_ROLE_CHANGED: 'user.role.changed',
  USER_STATUS_CHANGED: 'user.status.changed',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEntry {
  action: AuditActionValue | string;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: Role | null;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

/** Pull the client's IP and user agent off a request, for audit and tokens. */
export function requestContext(req: Request): { ipAddress: string; userAgent: string } {
  return {
    ipAddress: req.ip ?? 'unknown',
    userAgent: req.header('user-agent')?.slice(0, 255) ?? 'unknown',
  };
}

export const auditService = {
  async record(entry: AuditEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          action: entry.action,
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? null,
          actorRole: entry.actorRole ?? null,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (error) {
      logger.error('Failed to write audit log', {
        action: entry.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
