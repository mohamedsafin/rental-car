/**
 * docs/openapi.ts
 * ---------------------------------------------------------------------------
 * Builds the OpenAPI 3.1 document for the API.
 *
 * The PATHS are generated from the live router, not typed out by hand. A
 * hand-written spec is accurate on the day it is written and wrong within a
 * month, because nothing forces it to change when a route does. Generating it
 * means the spec cannot claim an endpoint that does not exist, or miss one
 * that does - and `npm run openapi:check` fails the build if the committed
 * file has drifted from the code.
 *
 * The DESCRIPTIONS are hand-written, because no generator can explain why
 * `POST /payments/webhook` is the only thing that may confirm a booking. They
 * live in `descriptions.ts`, keyed by "METHOD /path", and the generator
 * reports how many endpoints still lack one rather than quietly shipping a
 * spec full of "No description".
 *
 * Security requirements come from the same route inventory the security tests
 * use, so the spec's "this needs a token" and the server's actual behaviour
 * have one source.
 */
import { API_MOUNTS } from '../routes';
import { listRoutes, type RouteInfo } from '../utils/routeInventory';
import { ENDPOINT_DOCS, TAG_DESCRIPTIONS } from './descriptions';

interface OpenApiOperation {
  tags: string[];
  summary: string;
  description?: string;
  operationId: string;
  parameters?: unknown[];
  requestBody?: unknown;
  security?: { bearerAuth: [] }[];
  responses: Record<string, unknown>;
}

/** First path segment, e.g. "/fleet/fines" -> "fleet". */
function tagFor(path: string): string {
  const segment = path.split('/').filter(Boolean)[0] ?? 'root';
  return segment === 'admin' ? 'admin' : segment;
}

/** "GET /bookings/:id/cancel" -> "getBookingsIdCancel". */
function operationId(route: RouteInfo): string {
  const parts = route.path
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment.startsWith(':') ? `By${capitalise(segment.slice(1))}` : capitalise(segment)));

  return route.method.toLowerCase() + parts.join('');
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Express ":id" -> OpenAPI "{id}". */
function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function pathParameters(path: string): unknown[] {
  const names = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]!);

  return names.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string', format: name.toLowerCase().includes('id') ? 'uuid' : undefined },
    description: `The ${name}.`,
  }));
}

/**
 * Responses every endpoint can return.
 *
 * Listed once and referenced, so the envelope is documented in one place -
 * and so adding a status to the error handler is one edit here rather than a
 * hundred.
 */
function commonResponses(route: RouteInfo): Record<string, unknown> {
  const responses: Record<string, unknown> = {
    '200': { $ref: '#/components/responses/Success' },
    '400': { $ref: '#/components/responses/ValidationError' },
    '429': { $ref: '#/components/responses/RateLimited' },
    '500': { $ref: '#/components/responses/ServerError' },
  };

  if (['POST'].includes(route.method)) {
    responses['201'] = { $ref: '#/components/responses/Created' };
  }

  if (route.requiresAuth) {
    responses['401'] = { $ref: '#/components/responses/Unauthorised' };
  }

  if (route.allowedRoles.length > 0) {
    responses['403'] = { $ref: '#/components/responses/Forbidden' };
  }

  if (route.path.includes(':')) {
    responses['404'] = { $ref: '#/components/responses/NotFound' };
  }

  return responses;
}

export function buildOpenApiDocument(version: string): Record<string, unknown> {
  const routes = listRoutes(API_MOUNTS);
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  const usedTags = new Set<string>();
  let undocumented = 0;

  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    const documented = ENDPOINT_DOCS[key];
    if (!documented) undocumented += 1;

    const tag = tagFor(route.path);
    usedTags.add(tag);

    const openApiPath = toOpenApiPath(route.path);
    paths[openApiPath] ??= {};

    const roleNote =
      route.allowedRoles.length > 0
        ? `\n\nRequires role: ${route.allowedRoles.join(' or ')}.`
        : route.requiresAuth
          ? '\n\nRequires a signed-in user.'
          : '\n\nPublic - no token required.';

    paths[openApiPath][route.method.toLowerCase()] = {
      tags: [tag],
      summary: documented?.summary ?? `${route.method} ${route.path}`,
      description: `${documented?.description ?? ''}${roleNote}`.trim(),
      operationId: operationId(route),
      ...(route.path.includes(':') ? { parameters: pathParameters(route.path) } : {}),
      ...(documented?.requestBody ? { requestBody: documented.requestBody } : {}),
      // An empty array would mean "no security"; omitting the key entirely is
      // how OpenAPI says "inherits the global default", which for public
      // routes is wrong too. So public routes get an explicit empty list.
      security: route.requiresAuth ? [{ bearerAuth: [] }] : [],
      responses: commonResponses(route),
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'UAE Car Rental API',
      version,
      description: [
        'REST API for the UAE Car Rental system.',
        '',
        '## Response envelope',
        '',
        'Every response - success or failure - has the same shape, so a client',
        'never has to guess which one it received:',
        '',
        '```json',
        '{ "success": true, "data": { ... }, "message": "Success" }',
        '{ "success": false, "message": "...", "code": "VALIDATION_ERROR", "errors": [], "requestId": "..." }',
        '```',
        '',
        '## Money',
        '',
        'Every monetary value is a fixed 2-decimal STRING, never a number.',
        'It is a DECIMAL in PostgreSQL and never passes through a float at any',
        'point. Display it; do not compute with it. Totals come from the server.',
        '',
        '## Authentication',
        '',
        'A 15-minute bearer access token, plus a 7-day refresh token delivered',
        'as an httpOnly cookie. `POST /auth/refresh` rotates the pair and',
        'detects reuse: presenting an already-used refresh token revokes the',
        'whole family, on the assumption that it was stolen.',
        '',
        '## What the client may not send',
        '',
        'Prices, discounts and totals are calculated server-side and any such',
        'field in a request body is stripped before it reaches a handler. A',
        'promo code is a CODE; the engine decides what it is worth.',
      ].join('\n'),
      contact: { name: 'API support' },
    },
    servers: [
      { url: 'http://localhost:4000/api/v1', description: 'Local development' },
      { url: 'https://api.example.com/api/v1', description: 'Production - set at deploy time' },
    ],
    tags: [...usedTags].sort().map((name) => ({
      name,
      description: TAG_DESCRIPTIONS[name] ?? '',
    })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token from `POST /auth/login`. Expires after 15 minutes.',
        },
      },
      schemas: {
        Money: {
          type: 'string',
          pattern: '^-?\\d+\\.\\d{2}$',
          example: '249.50',
          description: 'A fixed 2-decimal string. Never a number - see Money above.',
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 137 },
            totalPages: { type: 'integer', example: 7 },
          },
          required: ['page', 'limit', 'total', 'totalPages'],
        },
        SuccessEnvelope: {
          type: 'object',
          properties: {
            success: { type: 'boolean', const: true },
            data: {},
            message: { type: 'string' },
          },
          required: ['success', 'data'],
        },
        ErrorEnvelope: {
          type: 'object',
          properties: {
            success: { type: 'boolean', const: false },
            message: { type: 'string', example: 'Validation failed' },
            code: {
              type: 'string',
              enum: [
                'VALIDATION_ERROR',
                'UNAUTHORIZED',
                'FORBIDDEN',
                'NOT_FOUND',
                'CONFLICT',
                'VEHICLE_UNAVAILABLE',
                'RATE_LIMITED',
                'FILE_UPLOAD_ERROR',
                'INTERNAL_ERROR',
              ],
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
            requestId: {
              type: 'string',
              description: 'Also returned as the X-Request-Id header. Quote it to support.',
            },
          },
          required: ['success', 'message', 'code'],
        },
      },
      responses: {
        Success: {
          description: 'Success.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } },
        },
        Created: {
          description: 'Created.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } },
        },
        ValidationError: {
          description: 'The request body, query or params failed validation.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
        },
        Unauthorised: {
          description: 'No token, an expired token, or one signed with the wrong key.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
        },
        Forbidden: {
          description:
            'Authenticated, but not permitted. The message deliberately does not say which role is required.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
        },
        NotFound: {
          description:
            'No such record - or one that exists but is not yours. Ownership failures return 404 rather than 403 on purpose: confirming a record exists is itself a leak.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
        },
        RateLimited: {
          description: 'Too many requests from this address.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
        },
        ServerError: {
          description:
            'Something went wrong. In production the message is generic; quote the requestId to support.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
        },
      },
    },
    'x-generation': {
      note: 'Paths are generated from the live router. Run `npm run openapi:generate` after adding a route.',
      routeCount: routes.length,
      undocumentedEndpoints: undocumented,
    },
  };
}
