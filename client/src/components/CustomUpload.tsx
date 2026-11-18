import React, { useRef } from "react";
import { Upload } from "lucide-react";

type Props = {
  addCustomAsset: (name: string, url: string) => void;
};

export default function CustomUpload({ addCustomAsset }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      // Only accept GLB/GLTF files for custom uploads
      const validExtensions = ['.glb', '.gltf'];
      const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

      if (!validExtensions.includes(fileExtension)) {
        alert(`Only .glb and .gltf files are supported for custom uploads. ${file.name} has extension ${fileExtension}`);
        return;
      }

      const reader = new FileReader();
      reader.onload = async (event) => {
        if (event.target?.result) {
          // Pass the filename (without extension) and the base64 URL
          addCustomAsset(file.name.replace(/\.[^/.]+$/, ""), event.target.result as string);
          
          /*
          try {
            await uploadModel(file, 'primitive objects');
          } catch (error) {
            console.error("Failed to upload model to server:", error);
          }
          */
        }
      };
      reader.readAsDataURL(file);
    });

    // Reset the input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-[14px] p-4 transition-colors duration-200 hover:border-white/[0.08]">
      <div className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-slate-500 mb-3 select-none">Custom Shape</div>
      <button 
        className="w-full py-2.5 px-4 rounded-lg bg-transparent border border-white/10 hover:border-accent hover:bg-accent/5 text-text-main text-xs font-semibold flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer shadow-sm"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload size={14} />
        Upload 
      </button>
      <input
        type="file"
        accept=".glb,.gltf"
        multiple
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
    </div>
  );
}
