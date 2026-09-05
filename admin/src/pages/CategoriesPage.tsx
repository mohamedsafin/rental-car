/**
 * pages/CategoriesPage.tsx
 * ---------------------------------------------------------------------------
 * Vehicle categories (BRD 8).
 *
 * Categories are structural, not cosmetic: they drive the customer site's
 * filters, they scope pricing rules and promo codes, and they decide the
 * silhouette a car is drawn with. Renaming one is safe; deleting one that
 * vehicles still point at is not, which is why the API refuses it and this
 * page shows the count before offering the button.
 *
 * `slug` is derived server-side from the name and never edited here - it is in
 * customer-facing URLs like /cars?category=suv, and letting an admin change it
 * would break links that are already out in the world.
 */
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, patchData, postData } from '../services/api';
import { useAdminCategories } from '../features/fleet/useFleetAdmin';
import FormField from '../components/FormField';
import type { NormalisedApiError } from '../types/api';
import type { VehicleCategory } from '../types/vehicle';

const EMPTY = { name: '', description: '', displayOrder: '0' };

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const { data, isPending } = useAdminCategories();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
    // The customer site filters on these too.
    void queryClient.invalidateQueries({ queryKey: ['categories'] });
  }

  const create = useMutation<unknown, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (payload) => postData('/categories', payload),
    onSuccess: () => {
      refresh();
      setShowForm(false);
      setForm(EMPTY);
    },
    onError: (err) => setError(err.message),
  });

  const update = useMutation<unknown, NormalisedApiError, { id: string; changes: Record<string, unknown> }>({
    mutationFn: ({ id, changes }) => patchData(`/categories/${id}`, changes),
    onSuccess: () => {
      refresh();
      setEditingId(null);
    },
    onError: (err) => setError(err.message),
  });

  const remove = useMutation<unknown, NormalisedApiError, string>({
    mutationFn: async (id) => {
      await api.delete(`/categories/${id}`);
    },
    onSuccess: refresh,
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    create.mutate({
      name: form.name,
      description: form.description || undefined,
      displayOrder: Number(form.displayOrder || 0),
    });
  }

  const categories = [...(data?.categories ?? [])].sort(
    (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0),
  );

  function vehicleCount(category: VehicleCategory): number {
    return category._count?.vehicles ?? 0;
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Categories</h2>
          <p className="text-sm text-slate-500">
            These drive the customer site&rsquo;s filters and scope pricing rules and promo codes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((open) => !open)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {showForm ? 'Cancel' : 'New category'}
        </button>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {showForm && (
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              label="Name"
              name="name"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              hint="The URL key is derived from this and cannot be changed later."
            />
            <FormField
              label="Description"
              name="description"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
            <FormField
              label="Display order"
              name="displayOrder"
              inputMode="numeric"
              value={form.displayOrder}
              onChange={(event) => setForm({ ...form, displayOrder: event.target.value })}
              hint="Lowest first on the customer site."
            />
          </div>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {create.isPending ? 'Creating...' : 'Create category'}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {isPending && <p className="px-5 py-8 text-sm text-slate-500">Loading...</p>}

        {!isPending && categories.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-slate-500">No categories yet.</p>
        )}

        {categories.length > 0 && (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">URL key</th>
                <th className="px-4 py-3">Vehicles</th>
                <th className="px-4 py-3">Shown</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.map((category) => {
                const count = vehicleCount(category);
                return (
                  <tr key={category.id}>
                    <td className="px-4 py-3 text-slate-500">{category.displayOrder ?? 0}</td>
                    <td className="px-4 py-3">
                      {editingId === category.id ? (
                        <input
                          aria-label="Category name"
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          className="w-48 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      ) : (
                        <span className="font-medium text-slate-900">{category.name}</span>
                      )}
                      {category.description && (
                        <span className="block text-xs text-slate-500">{category.description}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs text-slate-500">{category.slug}</code>
                    </td>
                    <td className="px-4 py-3">
                      {count > 0 ? (
                        <Link
                          to={`/vehicles?category=${category.slug}`}
                          className="text-slate-900 underline"
                        >
                          {count}
                        </Link>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() =>
                          update.mutate({
                            id: category.id,
                            changes: { isActive: !(category.isActive ?? true) },
                          })
                        }
                        className={
                          category.isActive ?? true
                            ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
                            : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600'
                        }
                      >
                        {category.isActive ?? true ? 'visible' : 'hidden'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {editingId === category.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                update.mutate({ id: category.id, changes: { name: editName } })
                              }
                              className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="text-xs text-slate-500 underline"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(category.id);
                                setEditName(category.name);
                                setError(null);
                              }}
                              className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                            >
                              Rename
                            </button>
                            {/*
                              Only offered when nothing points at it. The API
                              refuses either way; hiding the button avoids
                              inviting a click that can only fail.
                            */}
                            {count === 0 && (
                              <button
                                type="button"
                                onClick={() => remove.mutate(category.id)}
                                className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                              >
                                Delete
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Hiding a category removes it from the customer site&rsquo;s filters without touching the
        vehicles in it. A category with vehicles cannot be deleted.
      </p>
    </div>
  );
}
