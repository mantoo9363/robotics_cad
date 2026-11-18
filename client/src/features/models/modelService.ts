
export interface CadModel {
  id: number;
  name: string;
  uploaderEmail: string;
  sizeBytes: number;
  format: string;
  category: string;
  uploadDate: string;
  status: string;
  filePath?: string;
  canDelete?: boolean;
}

const DEFAULT_MODELS: CadModel[] = [
  { id: 1, name: 'cube.glb', filePath: '/uploads/cube.glb', format: '.glb', sizeBytes: 1596, category: 'primitive objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-05-27T06:50:58.919Z' },
  { id: 2, name: 'sphere.glb', filePath: '/uploads/sphere.glb', format: '.glb', sizeBytes: 143596, category: 'primitive objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-05-27T06:50:58.963Z' },
  { id: 3, name: 'cylinder.glb', filePath: '/uploads/cylinder.glb', format: '.glb', sizeBytes: 9956, category: 'primitive objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-05-27T06:50:58.977Z' },
  { id: 4, name: 'cone.glb', filePath: '/uploads/cone.glb', format: '.glb', sizeBytes: 5348, category: 'primitive objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-05-27T06:50:58.989Z' },
  { id: 5, name: 'torus.glb', filePath: '/uploads/torus.glb', format: '.glb', sizeBytes: 231180, category: 'primitive objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-05-27T06:50:59.012Z' },
  { id: 6, name: 'hexagon.glb', filePath: '/uploads/hexagon.glb', format: '.glb', sizeBytes: 2492, category: 'primitive objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-05-27T06:50:59.023Z' },
  { id: 7, name: 'cogwheel.glb', filePath: '/uploads/cogwheel.glb', format: '.glb', sizeBytes: 50084, category: 'combined objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-05-27T06:50:59.050Z' },
  { id: 8, name: 'pipe.glb', filePath: '/uploads/pipe.glb', format: '.glb', sizeBytes: 38184, category: 'combined objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-05-27T06:50:59.062Z' },
  { id: 9, name: 'lbracket.glb', filePath: '/uploads/lbracket.glb', format: '.glb', sizeBytes: 2464, category: 'combined objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-05-27T06:50:59.073Z' },
  { id: 10, name: 'arch.glb', filePath: '/uploads/arch.glb', format: '.glb', sizeBytes: 16296, category: 'combined objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-05-27T06:50:59.091Z' },
  { id: 11, name: 'stairs.glb', filePath: '/uploads/stairs.glb', format: '.glb', sizeBytes: 3360, category: 'combined objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-05-27T06:50:59.107Z' },
  { id: 12, name: 'bowl.glb', filePath: '/uploads/bowl.glb', format: '.glb', sizeBytes: 102156, category: 'combined objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-05-27T06:50:59.126Z' },
  { id: 17, name: 'Component 12.glb', filePath: '/uploads/component-12.glb', format: '.glb', sizeBytes: 89020, category: 'simlab objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-12T06:45:00.000Z' },
  { id: 18, name: 'Component 18.glb', filePath: '/uploads/component-18.glb', format: '.glb', sizeBytes: 81316, category: 'simlab objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-12T06:45:00.000Z' },
  { id: 19, name: 'Component 20.glb', filePath: '/uploads/component-20.glb', format: '.glb', sizeBytes: 72448, category: 'simlab objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-12T06:45:00.000Z' },
  { id: 20, name: 'Component 22.glb', filePath: '/uploads/component-22.glb', format: '.glb', sizeBytes: 103908, category: 'simlab objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-12T06:45:00.000Z' },
  { id: 21, name: 'Component 24.glb', filePath: '/uploads/component-24.glb', format: '.glb', sizeBytes: 107272, category: 'simlab objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-12T06:45:00.000Z' },
  { id: 22, name: 'Component 26.glb', filePath: '/uploads/component-26.glb', format: '.glb', sizeBytes: 150368, category: 'simlab objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-12T06:45:00.000Z' },
  { id: 23, name: 'Component 28.glb', filePath: '/uploads/component-28.glb', format: '.glb', sizeBytes: 125132, category: 'simlab objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-12T06:45:00.000Z' },
  { id: 24, name: 'Component 30.glb', filePath: '/uploads/component-30.glb', format: '.glb', sizeBytes: 133632, category: 'simlab objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-12T06:45:00.000Z' },
  { id: 25, name: 'box_frame.glb', filePath: '/uploads/box_frame.glb', format: '.glb', sizeBytes: 6076, category: 'combined objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-21T12:00:00.000Z' },
  { id: 26, name: 'capsule_shape.glb', filePath: '/uploads/capsule_shape.glb', format: '.glb', sizeBytes: 60212, category: 'primitive objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-21T12:00:00.000Z' },
  { id: 27, name: 'hourglass_shape.glb', filePath: '/uploads/hourglass_shape.glb', format: '.glb', sizeBytes: 51740, category: 'combined objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-21T12:00:00.000Z' },
  { id: 28, name: 'icosahedron.glb', filePath: '/uploads/icosahedron.glb', format: '.glb', sizeBytes: 4420, category: 'primitive objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-21T12:00:00.000Z' },
  { id: 29, name: 'octahedron.glb', filePath: '/uploads/octahedron.glb', format: '.glb', sizeBytes: 2220, category: 'primitive objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-21T12:00:00.000Z' },
  { id: 30, name: 'blue+star+3d+model.glb', filePath: '/uploads/blue+star+3d+model.glb', format: '.glb', sizeBytes: 7598272, category: 'combined objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-21T12:00:00.000Z' },
  // ids 31 (eu.glb) and 32 (hazer_turbo_81_-_low_poly_model.glb) removed — their
  // .glb files were deleted from public/uploads, so the tiles only ever rendered
  // a "Preview Error". Left in REMOVED_DEFAULT_IDS below so they get pruned from
  // any localStorage copy seeded before this change.
  { id: 33, name: 'portatovaglioli_estruso.glb', filePath: '/uploads/portatovaglioli_estruso.glb', format: '.glb', sizeBytes: 10040, category: 'combined objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-21T12:00:00.000Z' },
  { id: 34, name: 'rod_holder.glb', filePath: '/uploads/rod_holder.glb', format: '.glb', sizeBytes: 14566540, category: 'combined objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-21T12:00:00.000Z' },
  { id: 35, name: 'tyre_trackstar.glb', filePath: '/uploads/tyre_trackstar.glb', format: '.glb', sizeBytes: 6472648, category: 'combined objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-08-21T12:00:00.000Z' },
  // ids 36/38/39/40/42/43 removed as visual duplicates of existing primitives:
  //   diamond_octahedron≈octahedron, paraboloid≈cone/bowl dish, polygon_prism_hexagonal≈hexagon,
  //   ring≈torus, tube_hollow_cylinder≈pipe, wedge≈roof (kept the flatter roof).
  //   Listed in REMOVED_DEFAULT_IDS so they also clear from saved localStorage.
  { id: 37, name: 'hemisphere.glb', filePath: '/uploads/hemisphere.glb', format: '.glb', sizeBytes: 39916, category: 'primitive objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-09-07T10:51:00.000Z' },
  { id: 41, name: 'roof.glb', filePath: '/uploads/roof.glb', format: '.glb', sizeBytes: 864, category: 'combined objects', status: 'active', uploaderEmail: 'system', uploadDate: '2026-09-07T10:51:00.000Z' },
];

// ids whose default entry no longer exists — getLocalModels() strips these from
// any older localStorage copy.
//   31/32: eu.glb / hazer_turbo_81_-_low_poly_model.glb — .glb files deleted, tile
//          only ever rendered a "Preview Error".
//   36/38/39/40/42/43: visual duplicates of octahedron / cone / hexagon / torus /
//          pipe / roof respectively.
const REMOVED_DEFAULT_IDS = new Set([13, 14, 15, 16, 31, 32, 36, 38, 39, 40, 42, 43]);

const LOCAL_STORAGE_KEY = 'cad-studio-models';

const getLocalModels = (): CadModel[] => {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!saved) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(DEFAULT_MODELS));
    return DEFAULT_MODELS;
  }
  try {
    const rawParsed: CadModel[] = JSON.parse(saved);
    const defaultsById = new Map<number, CadModel>(
      DEFAULT_MODELS.map((d) => [d.id, d] as [number, CadModel]),
    );

    // Reconcile the saved copy against DEFAULT_MODELS (the committed source of
    // truth) rather than only appending new ids. A built-in's category/path can
    // change between releases; the old merge kept the stale copy, so the same
    // shape appeared under two category tabs at once. This also collapses
    // duplicate ids and drops a stale entry whose name shadows a built-in.
    const dupKey = (m: CadModel) =>
      `${(m.name || '').trim().toLowerCase()}|${m.format || ''}`;
    const seenIds = new Set<number>();
    const seenKeys = new Set<string>();
    const reconciled: CadModel[] = [];

    for (const m of rawParsed) {
      if (REMOVED_DEFAULT_IDS.has(m.id)) continue;
      if (seenIds.has(m.id)) continue;
      const def = defaultsById.get(m.id);
      // For a known built-in, refresh the mutable fields from source but keep
      // the saved `status` (respects a soft-delete) and `canDelete`.
      const entry: CadModel = def
        ? {
            ...m,
            name: def.name,
            format: def.format,
            category: def.category,
            filePath: def.filePath,
            sizeBytes: def.sizeBytes,
          }
        : m;
      const key = dupKey(entry);
      if (seenKeys.has(key)) continue;
      seenIds.add(m.id);
      seenKeys.add(key);
      reconciled.push(entry);
    }

    const missing = DEFAULT_MODELS.filter(
      (d) => !seenIds.has(d.id) && !seenKeys.has(dupKey(d)),
    );
    const merged = [...reconciled, ...missing];

    if (JSON.stringify(merged) !== saved) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(merged));
    }
    return merged;
  } catch (e) {
    console.error('Failed to parse local models, resetting to default', e);
    return DEFAULT_MODELS;
  }
};

export const fetchModels = async (): Promise<CadModel[]> => {
  return getLocalModels();
};

export const fetchPublicModels = async (): Promise<CadModel[]> => {
  const models = getLocalModels();
  return models.filter((m) => m.status === 'active');
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error(`Could not read "${file.name}"`));
    reader.readAsDataURL(file);
  });
}

// Base64 inflates the payload by roughly 4/3, and localStorage is capped around
// 5MB per origin for this whole app — uploaded models share that budget with
// the saved workspace. Rejecting oversized files up front with a message that
// explains why beats a QuotaExceededError surfacing from the setItem below.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export const uploadModel = async (file: File, category: string): Promise<CadModel> => {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)}MB. Uploads are ` +
        `capped at ${MAX_UPLOAD_BYTES / 1024 / 1024}MB because they are stored in ` +
        `the browser, not on a server.`,
    );
  }

  // Store the file's actual bytes as a data URL. The previous implementation
  // synthesised `/uploads/${file.name}` — a server path that nothing in this
  // repo ever creates, since there is no backend (see AGENTS.md) — so every
  // uploaded model 404'd the moment it was placed in a scene, and an
  // unencoded name with a space or '#' made it a malformed URL on top of
  // that. A data URL resolves directly through GLTFLoader, needs no encoding,
  // and survives reload because it lives in the localStorage record itself.
  // This is the same mechanism CustomUpload.tsx already uses for its own
  // uploads, so it matches the established persistence pattern rather than
  // introducing a second one.
  const dataUrl = await readFileAsDataUrl(file);

  const newModel: CadModel = {
    id: Date.now(),
    name: file.name,
    uploaderEmail: 'system',
    sizeBytes: file.size,
    format: file.name.substring(file.name.lastIndexOf('.')),
    category: category,
    status: 'active',
    uploadDate: new Date().toISOString(),
    filePath: dataUrl,
    canDelete: true,
  };

  const models = getLocalModels();
  models.push(newModel);
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(models));
  } catch (err) {
    console.error('[modelService] failed to persist uploaded model', err);
    throw new Error(
      `Could not save "${file.name}" — browser storage is full. Delete some ` +
        `uploaded models and try again.`,
    );
  }

  window.dispatchEvent(new CustomEvent('modelUpdated'));
  return newModel;
};

export const deleteModel = async (id: number): Promise<void> => {
  const models = getLocalModels();
  const index = models.findIndex((m) => m.id === id);
  if (index !== -1) {
    const deletedModel = models[index];
    deletedModel.status = 'deleted';
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(models));
    window.dispatchEvent(new CustomEvent('modelDeleted', { detail: deletedModel }));
    window.dispatchEvent(new CustomEvent('modelUpdated'));
  }
};
