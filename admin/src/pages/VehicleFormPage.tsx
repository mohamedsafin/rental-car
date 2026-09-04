/**
 * pages/VehicleFormPage.tsx
 * ---------------------------------------------------------------------------
 * Create and edit a vehicle. One component serves both, because the fields are
 * identical and duplicating them would guarantee they drift apart.
 *
 * `id === 'new'` is the only difference: create mode POSTs and then navigates
 * to the edit page, which is where images can be attached (an image needs a
 * vehicle to belong to).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import FormField from '../components/FormField';
import VehicleImageManager from '../components/VehicleImageManager';
import VehicleDocuments from '../components/VehicleDocuments';
import {
  useAdminCategories,
  useAdminLocations,
  useAdminVehicle,
  useCreateVehicle,
  useDeleteVehicle,
  useFeatures,
  useUpdateVehicle,
} from '../features/fleet/useFleetAdmin';
import { toApiPayload, vehicleFormSchema, type VehicleFormValues } from '../features/fleet/vehicleSchema';
import type { NormalisedApiError } from '../types/api';

const DEFAULTS: VehicleFormValues = {
  brand: '',
  model: '',
  year: new Date().getFullYear(),
  variant: '',
  registrationNumber: '',
  categoryId: '',
  locationId: '',
  seats: 5,
  doors: 4,
  transmission: 'AUTOMATIC',
  fuelType: 'PETROL',
  color: '',
  dailyPrice: '',
  weeklyPrice: '',
  monthlyPrice: '',
  securityDeposit: '',
  mileageLimitPerDay: '',
  extraMileageCharge: '',
  status: 'AVAILABLE',
  isFeatured: false,
  isPublished: true,
  description: '',
};

export default function VehicleFormPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const navigate = useNavigate();

  const { data: categoryData } = useAdminCategories();
  const { data: locationData } = useAdminLocations();
  const { data: featureData } = useFeatures();
  const { data: vehicleData, isPending: loadingVehicle } = useAdminVehicle(isNew ? undefined : id);

  const createVehicle = useCreateVehicle();
  const updateVehicle = useUpdateVehicle();
  const deleteVehicle = useDeleteVehicle();

  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: DEFAULTS,
  });

  // Populate the form once the vehicle arrives. Money fields are copied as the
  // strings the API sent - never parsed into numbers and re-formatted.
  useEffect(() => {
    if (!vehicleData) return;
    const v = vehicleData.vehicle;

    reset({
      brand: v.brand,
      model: v.model,
      year: v.year,
      variant: v.variant ?? '',
      registrationNumber: v.registrationNumber ?? '',
      categoryId: v.category.id,
      locationId: v.location?.id ?? '',
      seats: v.seats,
      doors: v.doors,
      transmission: v.transmission,
      fuelType: v.fuelType,
      color: v.color ?? '',
      dailyPrice: v.pricing.daily,
      weeklyPrice: v.pricing.weekly ?? '',
      monthlyPrice: v.pricing.monthly ?? '',
      securityDeposit: v.pricing.securityDeposit,
      mileageLimitPerDay: v.mileage.limitPerDay ? String(v.mileage.limitPerDay) : '',
      extraMileageCharge: v.mileage.extraCharge ?? '',
      status: v.status,
      isFeatured: v.isFeatured,
      isPublished: v.isPublished,
      description: v.description ?? '',
    });
    setSelectedFeatures(v.features.map((f) => f.id));
  }, [vehicleData, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSaved(false);
    const payload = toApiPayload(values, selectedFeatures);

    const handleError = (error: NormalisedApiError) => {
      // Map field errors from the backend onto their inputs, so a rule we did
      // not mirror client-side still lands next to the field it concerns.
      if (error.errors.length > 0) {
        error.errors.forEach((fieldError) => {
          setError(fieldError.field as keyof VehicleFormValues, { message: fieldError.message });
        });
      } else {
        setServerError(error.message);
      }
    };

    if (isNew) {
      createVehicle.mutate(payload, {
        onSuccess: (result) => navigate(`/vehicles/${result.vehicle.id}`, { replace: true }),
        onError: handleError,
      });
    } else {
      updateVehicle.mutate(
        { id: id as string, changes: payload },
        { onSuccess: () => setSaved(true), onError: handleError },
      );
    }
  });

  function toggleFeature(featureId: string) {
    setSelectedFeatures((current) =>
      current.includes(featureId)
        ? current.filter((f) => f !== featureId)
        : [...current, featureId],
    );
  }

  if (!isNew && loadingVehicle) {
    return <div className="h-96 animate-pulse rounded-lg bg-slate-200" />;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/vehicles" className="text-sm text-slate-500 hover:underline">
            &larr; Vehicles
          </Link>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            {isNew ? 'Add vehicle' : vehicleData?.vehicle.name}
          </h2>
        </div>

        {!isNew && (
          <button
            type="button"
            onClick={() => {
              if (!window.confirm('Remove this vehicle from the fleet?')) return;
              deleteVehicle.mutate(id as string, {
                onSuccess: () => navigate('/vehicles'),
                onError: (error) => setServerError(error.message),
              });
            }}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
        )}
      </div>

      {serverError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {serverError}
        </div>
      )}
      {saved && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Changes saved.
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
          <legend className="px-1 text-sm font-semibold text-slate-900">Identity</legend>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <FormField label="Brand" error={errors.brand?.message} {...register('brand')} />
            <FormField label="Model" error={errors.model?.message} {...register('model')} />
            <FormField label="Variant" hint="Optional" error={errors.variant?.message} {...register('variant')} />
            <FormField label="Model year" type="number" error={errors.year?.message} {...register('year')} />
            <FormField
              label="Registration number"
              hint="Must be unique across the fleet"
              error={errors.registrationNumber?.message}
              {...register('registrationNumber')}
            />
            <FormField label="Colour" hint="Optional" error={errors.color?.message} {...register('color')} />

            <Select label="Category" error={errors.categoryId?.message} {...register('categoryId')}>
              <option value="">Select a category</option>
              {categoryData?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>

            <Select label="Home location" error={errors.locationId?.message} {...register('locationId')}>
              <option value="">Not assigned</option>
              {locationData?.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
          <legend className="px-1 text-sm font-semibold text-slate-900">Specification</legend>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <FormField label="Seats" type="number" error={errors.seats?.message} {...register('seats')} />
            <FormField label="Doors" type="number" error={errors.doors?.message} {...register('doors')} />
            <Select label="Transmission" error={errors.transmission?.message} {...register('transmission')}>
              <option value="AUTOMATIC">Automatic</option>
              <option value="MANUAL">Manual</option>
            </Select>
            <Select label="Fuel type" error={errors.fuelType?.message} {...register('fuelType')}>
              <option value="PETROL">Petrol</option>
              <option value="DIESEL">Diesel</option>
              <option value="HYBRID">Hybrid</option>
              <option value="ELECTRIC">Electric</option>
            </Select>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
          <legend className="px-1 text-sm font-semibold text-slate-900">Pricing (AED)</legend>
          <p className="mt-1 text-xs text-slate-500">
            Enter amounts as text, e.g. 650 or 649.50. Seasonal and weekend rates arrive with the
            pricing engine.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <FormField
              label="Daily rate"
              inputMode="decimal"
              error={errors.dailyPrice?.message}
              {...register('dailyPrice')}
            />
            <FormField
              label="Security deposit"
              inputMode="decimal"
              error={errors.securityDeposit?.message}
              {...register('securityDeposit')}
            />
            <FormField
              label="Weekly rate"
              hint="Optional"
              inputMode="decimal"
              error={errors.weeklyPrice?.message}
              {...register('weeklyPrice')}
            />
            <FormField
              label="Monthly rate"
              hint="Optional"
              inputMode="decimal"
              error={errors.monthlyPrice?.message}
              {...register('monthlyPrice')}
            />
            <FormField
              label="Mileage limit per day (km)"
              hint="Leave blank for unlimited"
              type="number"
              error={errors.mileageLimitPerDay?.message}
              {...register('mileageLimitPerDay')}
            />
            <FormField
              label="Extra mileage charge (per km)"
              hint="Optional"
              inputMode="decimal"
              error={errors.extraMileageCharge?.message}
              {...register('extraMileageCharge')}
            />
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
          <legend className="px-1 text-sm font-semibold text-slate-900">Features</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {featureData?.features.map((feature) => (
              <label
                key={feature.id}
                className={
                  selectedFeatures.includes(feature.id)
                    ? 'cursor-pointer rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-sm text-white'
                    : 'cursor-pointer rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:border-slate-400'
                }
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={selectedFeatures.includes(feature.id)}
                  onChange={() => toggleFeature(feature.id)}
                />
                {feature.name}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
          <legend className="px-1 text-sm font-semibold text-slate-900">
            Availability and visibility
          </legend>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Select label="Operational status" error={errors.status?.message} {...register('status')}>
              <option value="AVAILABLE">Available</option>
              <option value="RESERVED">Reserved</option>
              <option value="RENTED">Rented</option>
              <option value="UNDER_INSPECTION">Under inspection</option>
              <option value="UNDER_MAINTENANCE">Under maintenance</option>
              <option value="UNAVAILABLE">Unavailable</option>
            </Select>

            <div className="flex flex-col justify-center gap-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" {...register('isPublished')} className="rounded border-slate-300" />
                Visible on the customer website
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" {...register('isFeatured')} className="rounded border-slate-300" />
                Show in featured vehicles
              </label>
            </div>
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">Description</span>
            <textarea
              rows={3}
              {...register('description')}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </label>
        </fieldset>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting || createVehicle.isPending || updateVehicle.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isNew ? 'Create vehicle' : 'Save changes'}
          </button>
          <Link to="/vehicles" className="text-sm text-slate-600 hover:underline">
            Cancel
          </Link>
        </div>
      </form>

      {/* Images need a saved vehicle to attach to. */}
      {!isNew && vehicleData && <VehicleImageManager vehicle={vehicleData.vehicle} />}
      {!isNew && vehicleData && <VehicleDocuments vehicleId={vehicleData.vehicle.id} />}
      {isNew && (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
          Save the vehicle first, then you can upload its images.
        </p>
      )}
    </div>
  );
}

function Select({
  label,
  error,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select
        {...props}
        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </label>
  );
}
