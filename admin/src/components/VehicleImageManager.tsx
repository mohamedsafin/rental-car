/**
 * components/VehicleImageManager.tsx
 * ---------------------------------------------------------------------------
 * Upload, re-order and delete vehicle images (BRD 41).
 *
 * Only shown when editing an EXISTING vehicle: an image has to belong to
 * something, so the vehicle must be saved before its photos can be uploaded.
 *
 * Every action re-renders from the server's response rather than optimistically
 * patching local state. Uploads can be rejected (wrong type, too large, failed
 * magic-byte check), and showing an image that the server refused would be a
 * lie the admin only discovers on the customer site.
 */
import { useRef, useState } from 'react';
import {
  useDeleteImage,
  useSetPrimaryImage,
  useUploadVehicleImages,
} from '../features/fleet/useFleetAdmin';
import type { Vehicle } from '../types/vehicle';

const IMAGE_TYPES = [
  { value: 'EXTERIOR_FRONT', label: 'Exterior - front' },
  { value: 'EXTERIOR_REAR', label: 'Exterior - rear' },
  { value: 'EXTERIOR_LEFT', label: 'Exterior - left' },
  { value: 'EXTERIOR_RIGHT', label: 'Exterior - right' },
  { value: 'INTERIOR_DASHBOARD', label: 'Interior - dashboard' },
  { value: 'INTERIOR_FRONT', label: 'Interior - front' },
  { value: 'INTERIOR_REAR', label: 'Interior - rear' },
  { value: 'INTERIOR_SEATS', label: 'Interior - seats' },
  { value: 'OTHER', label: 'Other' },
];

export default function VehicleImageManager({ vehicle }: { vehicle: Vehicle }) {
  const [type, setType] = useState('EXTERIOR_FRONT');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = useUploadVehicleImages();
  const setPrimary = useSetPrimaryImage();
  const remove = useDeleteImage();

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);

    upload.mutate(
      { vehicleId: vehicle.id, files: Array.from(files), type },
      {
        onError: (error) => setUploadError(error.message),
        onSettled: () => {
          // Clear the input so selecting the SAME file again still fires
          // onChange - otherwise a retry after a failure appears to do nothing.
          if (fileInput.current) fileInput.current.value = '';
        },
      },
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-slate-900">Images</h3>
      <p className="mt-1 text-sm text-slate-600">
        JPEG, PNG or WebP. The primary image is the one customers see on the listing card.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Image type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {IMAGE_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          disabled={upload.isPending}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
        />

        {upload.isPending && <span className="text-sm text-slate-500">Uploading...</span>}
      </div>

      {uploadError && (
        <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {uploadError}
        </div>
      )}

      {vehicle.images.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No images yet. This vehicle will show a placeholder on the customer site.
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {vehicle.images.map((image) => (
            <li key={image.id} className="overflow-hidden rounded-md border border-slate-200">
              <div className="relative aspect-[4/3] bg-slate-100">
                <img src={image.url} alt={image.altText} className="h-full w-full object-cover" />
                {image.isPrimary && (
                  <span className="absolute left-1 top-1 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    Primary
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 p-2">
                <span className="truncate text-[10px] text-slate-500">
                  {image.type.replace(/_/g, ' ').toLowerCase()}
                </span>
                <div className="flex shrink-0 gap-1">
                  {!image.isPrimary && (
                    <button
                      type="button"
                      onClick={() =>
                        setPrimary.mutate({ vehicleId: vehicle.id, imageId: image.id })
                      }
                      className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50"
                    >
                      Set primary
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove.mutate({ vehicleId: vehicle.id, imageId: image.id })}
                    className="rounded border border-red-300 px-1.5 py-0.5 text-[10px] text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
