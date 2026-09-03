/**
 * modules/categories/validation.ts
 * ---------------------------------------------------------------------------
 * Note there is no `slug` field: the server derives it from the name. See
 * utils/slug.ts for why a client must not choose it.
 */
import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z.string().min(2, 'Category name is required').max(60).trim(),
  description: z.string().max(500).trim().optional(),
  displayOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const updateCategorySchema = createCategorySchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Provide at least one field to update' },
);

export const categoryIdParamSchema = z.object({
  id: z.string().uuid('Invalid category id'),
});

export const listCategoriesQuerySchema = z.object({
  /// Admin lists everything; the customer site only ever wants active ones.
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;
