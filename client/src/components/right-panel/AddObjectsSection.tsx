import React, { useState, useMemo, useDeferredValue, Suspense, useEffect } from "react";
import { useGLTF } from "@react-three/drei";
import { X } from "lucide-react";
import type { ShapeType, CustomAsset } from "../../App";
import CustomUpload from "../CustomUpload";
import { fetchPublicModels, deleteModel, type CadModel } from "../../features/models/modelService";
import toast from "react-hot-toast";
import type { DropPayload } from "../canvas/DropPlacement";
import { renderObjectThumbnail } from "../../lib/glbThumbnailRenderer";
import ErrorBoundary from "../ErrorBoundary";

// Trailing slash trimmed — see CadStudio.tsx. filePath values already start with "/".
const BASE_URL = "/cad-assets/".replace(/\/$/, '');

// The thumbnail-tile fallback this file's own boundary used to hardcode.
// Extracted alongside the boundary itself (now shared, see
// components/ErrorBoundary.tsx) so the same class can also guard the routes
// and canvases, which need entirely different fallbacks.
const PreviewErrorTile = (
  <div style={{
    width: "100%",
    height: "100%",
    background: "#3b82f6",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontSize: "10px",
    textAlign: "center",
    padding: "4px"
  }}>
    Preview Error
  </div>
);

function handleDragStart(
  e: React.DragEvent,
  payload: DropPayload,
  startPlacement: (payload: DropPayload | null) => void,
) {
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData("application/json", JSON.stringify(payload));
  // Drive the same ghost-preview used for click-to-place while the drag is in progress.
  startPlacement(payload);
}

function GlbThumbnail({ url, topView }: { url: string; topView?: boolean }) {
  const { scene } = useGLTF(url);
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    try {
      // Keyed on the URL so an asset is rasterised once per session rather
      // than on every grid re-render — each render otherwise uploads its
      // buffers into the offscreen context, which never releases them
      // (BUG-040).
      setImgSrc(renderObjectThumbnail(scene.clone(), url, topView ? "top" : "front"));
    } catch (error) {
      console.error('Failed to render thumbnail:', error);
    }
  }, [scene, url, topView]);

  if (!imgSrc) {
    return <div style={{ width: "100%", height: "100%" }} />;
  }

  return (
    <img
      src={imgSrc}
      alt=""
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        pointerEvents: "none",
      }}
    />
  );
}

type AddObjectsSectionProps = {
  startPlacement: (payload: DropPayload | null) => void;
  customAssets: CustomAsset[];
  addCustomAsset: (name: string, url: string) => void;
  removeCustomAsset: (id: string) => void;
  searchQuery?: string;
};

export function AddObjectsSection({
  startPlacement,
  customAssets,
  addCustomAsset,
  removeCustomAsset,
  searchQuery = "",
}: AddObjectsSectionProps) {
  const [selectedCategory, setSelectedCategory] = useState<"primitive" | "combined" | "simlabs">("primitive");
  const [adminModels, setAdminModels] = useState<CadModel[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<{ modelId: number; modelName: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadAdminModels = async () => {
    try {
      const models = await fetchPublicModels();
      setAdminModels(models);
    } catch (err) {
      console.error("Failed to load admin models", err);
    }
  };

  useEffect(() => {
    loadAdminModels();
    
    window.addEventListener('modelUpdated', loadAdminModels);
    
    return () => {
      window.removeEventListener('modelUpdated', loadAdminModels);
    };
  }, []);

  const handleDeleteModel = async (modelId: number, modelName: string) => {
    setDeleteConfirm({ modelId, modelName });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    
    const toastId = toast.loading('Deleting model...');
    try {
      setIsDeleting(true);
      await deleteModel(deleteConfirm.modelId);
      await loadAdminModels();
      toast.success('Model deleted successfully', { id: toastId });
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Failed to delete model', err);
      toast.error('Failed to delete model', { id: toastId });
    } finally {
      setIsDeleting(false);
    }
  };



  const renderAdminModel = (model: CadModel) => {
    // Encode the filename portion to handle spaces and special characters
    const modelUrl = model.filePath 
      ? `${BASE_URL}${model.filePath}`
      : `${BASE_URL}/uploads/${encodeURIComponent(model.name)}${model.format}`;
    const isGlb = model.format === '.glb' || model.format === '.gltf';
    const canDelete = model.canDelete;
    const payload: DropPayload = isGlb
      ? { kind: "glb", url: modelUrl }
      : { kind: "shape", type: "cube" };

    return (
      <ErrorBoundary key={`admin-${model.id}`} label="model thumbnail" fallback={PreviewErrorTile}>
        <div className="relative group">
          <button
            className="relative w-full bg-white/[0.03] border border-white/[0.06] rounded-lg p-2 flex flex-col items-center cursor-pointer transition-all duration-250 overflow-hidden hover:border-accent/40 hover:-translate-y-[3px] hover:shadow-[0_8px_24px_rgba(0,0,0,0.3),0_0_0_1px_rgba(67,97,238,0.15)] active:translate-y-px active:scale-[0.98]"
            draggable
            onDragStart={(e) => handleDragStart(e, payload, startPlacement)}
            onDragEnd={() => startPlacement(null)}
            onClick={() => startPlacement(payload)}
          >
            <div className="w-full h-8 flex items-center justify-center relative z-10 mb-1" style={{ padding: 0, overflow: "hidden" }}>
              {isGlb ? (
                <Suspense
                  fallback={
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        background: "#3b82f6",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "white",
                        fontSize: "10px",
                        textAlign: "center",
                        padding: "4px"
                      }}
                    >
                      Loading 3D...
                    </div>
                  }
                >
                  <GlbThumbnail url={modelUrl} topView={model.category === 'simlab objects'} />
                </Suspense>
              ) : (
                <div className="w-[60%] h-[60%] bg-[#3b82f6]/50 rounded" />
              )}
            </div>
            <span
              className="text-[0.55rem] font-bold capitalize text-slate-300 relative z-10 tracking-wide truncate max-w-full mt-0.5"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                width: "100%",
                textAlign: "center",
              }}
            >
              {model.name.replace(/\.glb$/i, '')}
            </span>
          </button>
          {canDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteModel(model.id, model.name);
              }}
              className="absolute top-1 right-1 z-20 p-1 bg-red-500/80 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              title="Delete model"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </ErrorBoundary>
    );
  };

  // Deferred so typing in the search box stays responsive: the grid re-render
  // (and the useGLTF thumbnail loads it triggers) run at low priority on the
  // settled query, not on every keystroke. Query lowercased once, not per row.
  const deferredQuery = useDeferredValue(searchQuery);
  const q = deferredQuery.toLowerCase();

  const primitivesModels = useMemo(
    () => adminModels.filter((m) => m.category === "primitive objects" && m.name.toLowerCase().includes(q)),
    [adminModels, q],
  );
  const combinedModels = useMemo(
    () => adminModels.filter((m) => m.category === "combined objects" && m.name.toLowerCase().includes(q)),
    [adminModels, q],
  );
  const simlabModels = useMemo(
    () => adminModels.filter((m) => m.category === "simlab objects" && m.name.toLowerCase().includes(q)),
    [adminModels, q],
  );
  const filteredCustomAssets = useMemo(
    () => customAssets.filter((asset) => asset.name.toLowerCase().includes(q)),
    [customAssets, q],
  );

  return (
    <>
      {/* Shapes Library with Category Dropdown */}
      <div className="bg-white/[0.02] border border-white/[0.05] rounded-[10px] p-2 transition-colors duration-200 hover:border-white/[0.08]">
        <div className="mb-3.5 select-none">
  
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as "primitive" | "combined" | "simlabs")}
            className="bg-white/[0.3] border border-white/30 hover:border-white/[0.15]  text-[12px] font-bold uppercase tracking-wider rounded-sm px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 cursor-pointer w-full"
          >
            <option value="primitive" className="bg-slate-900 font-semibold text-center text-slate-300">Primitives</option>
            <option value="combined" className="bg-slate-900 font-semibold text-center text-slate-300">Combined</option>
            <option value="simlabs" className="bg-slate-900 font-semibold text-center text-slate-300">Simlabs</option>
          </select>
        </div>

        <div className="animate-[slideIn_0.3s_ease]">
          {selectedCategory === "primitive" ? (
            <div className="grid grid-cols-2 gap-1.5">
              {primitivesModels.map(renderAdminModel)}
              {filteredCustomAssets
                .map((asset) => (
                <ErrorBoundary key={asset.id} label="custom asset thumbnail" fallback={PreviewErrorTile}>
                  <div className="relative group">
                    <button
                      className="relative w-full bg-white/[0.03] border border-white/[0.06] rounded-lg p-2 flex flex-col items-center cursor-pointer transition-all duration-250 overflow-hidden hover:border-accent/40 hover:-translate-y-[3px] hover:shadow-[0_8px_24px_rgba(0,0,0,0.3),0_0_0_1px_rgba(67,97,238,0.15)] active:translate-y-px active:scale-[0.98]"
                      draggable
                      onDragStart={(e) => handleDragStart(e, { kind: "glb", url: asset.url }, startPlacement)}
                      onDragEnd={() => startPlacement(null)}
                      onClick={() => startPlacement({ kind: "glb", url: asset.url })}
                    >
                      <div
                        className="w-full h-8 flex items-center justify-center relative z-10 mb-1 custom-glb"
                        style={{ padding: 0, overflow: "hidden" }}
                      >
                        <Suspense
                          fallback={
                            <div
                              style={{
                                width: "100%",
                                height: "100%",
                                background: "#3b82f6",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "white",
                                fontSize: "10px",
                                textAlign: "center",
                                padding: "4px"
                              }}
                            >
                              Loading 3D...
                            </div>
                          }
                        >
                          <GlbThumbnail url={asset.url} />
                        </Suspense>
                      </div>
                      <span
                        className="text-[0.55rem] font-bold capitalize text-slate-300 relative z-10 tracking-wide truncate max-w-full mt-0.5"
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          width: "100%",
                          textAlign: "center",
                        }}
                      >
                        {asset.name.replace(/\.glb$/i, '')}
                      </span>
                    </button>
                    <button
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500/80 hover:bg-red-600 text-white border-0 text-sm font-bold flex items-center justify-center cursor-pointer z-20 transition-all hover:scale-110"
                      onClick={() => removeCustomAsset(asset.id)}
                      title="Remove custom shape"
                    >
                      &times;
                    </button>
                  </div>
                </ErrorBoundary>
              ))}
            </div>
          ) : selectedCategory === "combined" ? (
            <div className="grid grid-cols-2 gap-1.5">
              {combinedModels.map(renderAdminModel)}
            </div>
          ) : selectedCategory === "simlabs" ? (
            <div className="grid grid-cols-2 gap-1.5">
              {simlabModels.map(renderAdminModel)}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { type: "cube", label: "Cube" },
                { type: "sphere", label: "Sphere" },
                { type: "cylinder", label: "Cylinder" },
                { type: "cone", label: "Cone" },
                { type: "pipe", label: "Pipe" },
                { type: "cogwheel", label: "Cogwheel" },
                { type: "lbracket", label: "L-Bracket" },
                { type: "hexagon", label: "Hexagon" },
                { type: "arch", label: "Arch" },
                { type: "stairs", label: "Stairs" },
                { type: "bowl", label: "Bowl" },
                { type: "torus", label: "Torus" },
              ].map((part) => (
                <button
                  key={part.type}
                  draggable
                  onDragStart={(e) => handleDragStart(e, { kind: "shape", type: part.type }, startPlacement)}
                  onDragEnd={() => startPlacement(null)}
                  onClick={() => startPlacement({ kind: "shape", type: part.type })}
                  className="py-2 px-1.5 rounded-md text-[9px] font-semibold text-slate-300 bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.08] hover:border-indigo-500/30 hover:text-white cursor-pointer transition-all text-center"
                >
                  {part.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Custom Upload */}
      <CustomUpload addCustomAsset={addCustomAsset} />

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200 text-left">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Delete Model</h3>
            <p className="text-sm text-slate-600 mb-6 whitespace-normal">
              Are you sure you want to delete <span className="font-semibold text-slate-900">{deleteConfirm.modelName}</span>? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
