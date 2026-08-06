"use client";

import { useMemo, useRef, useState } from "react";
import type { AssetKind, MediaAsset, MediaFolder } from "@/types";
import { useEditorStore } from "@/hooks/useEditorStore";
import { UPLOAD_ACCEPT, useMediaUpload } from "@/hooks/useMediaUpload";
import { assetKind } from "@/lib/timeline/tracks";
import { filmstripUrl, localMediaUrl, mediaUrl } from "@/lib/video/client";
import { formatTime } from "@/lib/video/timeline";
import GoogleDriveButton from "./GoogleDriveButton";
import { PairAudioModal } from "./PairAudioModal";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clapperboard,
  Cloud,
  CloudUpload,
  Film,
  Folder,
  FolderInput,
  FolderOpen,
  Grid2X2,
  Image as ImageIcon,
  Link2,
  List,
  Music2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

type FolderFilter = "all" | "unfiled" | string;
type KindFilter = "all" | AssetKind;
type ViewMode = "grid" | "list";

export default function LibraryPanel({ onOpenSmart }: { onOpenSmart?: () => void }) {
  // `onOpenSmart` now lands on the Montage tool — the one-tap build lives there.
  const media = useEditorStore((state) => state.media);
  const folders = useEditorStore((state) => state.mediaFolders);
  const tracks = useEditorStore((state) => state.tracks);
  const createFolder = useEditorStore((state) => state.createMediaFolder);
  const renameFolder = useEditorStore((state) => state.renameMediaFolder);
  const deleteFolder = useEditorStore((state) => state.deleteMediaFolder);
  const moveMediaToFolder = useEditorStore((state) => state.moveMediaToFolder);
  const addMediaBatchToTimeline = useEditorStore((state) => state.addMediaBatchToTimeline);
  const addMediaToTrack = useEditorStore((state) => state.addMediaToTrack);
  const setMusicFromAsset = useEditorStore((state) => state.setMusicFromAsset);
  const addToast = useEditorStore((state) => state.addToast);
  const { uploading, handleFiles } = useMediaUpload();

  const inputRef = useRef<HTMLInputElement>(null);
  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("list");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pairingVideo, setPairingVideo] = useState<MediaAsset | null>(null);

  const onTimeline = useMemo(
    () =>
      new Set(
        tracks.flatMap((track) =>
          track.clips.flatMap((clip) => (clip.assetId ? [clip.assetId] : []))
        )
      ),
    [tracks]
  );

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("en-US");
    return media.filter((asset) => {
      if (kindFilter !== "all" && assetKind(asset) !== kindFilter) return false;
      if (folderFilter === "unfiled" && asset.folderId) return false;
      if (folderFilter !== "all" && folderFilter !== "unfiled" && asset.folderId !== folderFilter) {
        return false;
      }
      return !normalized || asset.originalName.toLocaleLowerCase("en-US").includes(normalized);
    });
  }, [media, query, kindFilter, folderFilter]);

  const selected = selectedIds
    .map((id) => media.find((asset) => asset.id === id))
    .filter((asset): asset is MediaAsset => Boolean(asset));
  const selectedVideos = selected.filter((asset) => assetKind(asset) === "video");
  const currentFolder = folders.find((folder) => folder.id === folderFilter);

  const toggleSelected = (id: string) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));

  const submitFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    const id = createFolder(name);
    setFolderFilter(id);
    setNewFolderName("");
    setCreatingFolder(false);
  };

  const addSelectionToTimeline = (openSmart: boolean) => {
    if (selectedVideos.length === 0) {
      addToast("info", "Select at least one video.");
      return;
    }
    addMediaBatchToTimeline(selectedVideos.map((asset) => asset.id));
    if (openSmart) onOpenSmart?.();
    setSelectedIds([]);
  };

  const dropIntoFolder = (event: React.DragEvent, folderId: string | null) => {
    event.preventDefault();
    const ids = event.dataTransfer
      .getData("application/x-captioncut-media")
      .split(",")
      .filter(Boolean);
    if (ids.length === 0) return;
    moveMediaToFolder(ids, folderId);
    setSelectedIds(ids);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--panel)]">
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) void handleFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="border-b border-white/[0.07] px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="panel-eyebrow text-[var(--timeline)]">Media</p>
            <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text)]">
              Source library
            </h2>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">
              Import, organize, and add clips to the timeline.
            </p>
          </div>
          <span className="rounded-full bg-white/[0.045] px-2 py-1 font-mono text-[9px] text-[#7d8997] ring-1 ring-white/[0.07]">
            {media.length} {media.length === 1 ? "file" : "files"}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="primary-compact"
          >
            <Upload size={12} /> Import
          </button>
          <GoogleDriveButton className="secondary-compact">
            <Cloud size={12} className="text-[var(--timeline)]" /> Drive
          </GoogleDriveButton>
        </div>

        {uploading && (
          <div className="mt-2 rounded-lg bg-[#080c11] p-2.5 ring-1 ring-white/[0.08]">
            <div className="flex items-center justify-between gap-2 text-[9px]">
              <span className="truncate text-[#aab5c1]">
                Ready to edit · syncing {uploading.index}/{uploading.total} · {uploading.name}
              </span>
              <span className="font-mono text-[var(--cut)]">
                {Math.round(uploading.progress * 100)}%
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className="h-full rounded-full bg-[var(--cut)] transition-[width]"
                style={{ width: `${uploading.progress * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="border-b border-white/[0.07] px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <label className="relative min-w-0 flex-1">
            <Search
              size={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5f6b78]"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files…"
              className="h-8 w-full rounded-lg border-0 bg-[#080c11] pl-8 pr-7 text-[10px] text-[#dbe2e8] outline-none ring-1 ring-white/[0.08] placeholder:text-[#515c69] focus:ring-[var(--timeline)]/45"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#65717f] hover:text-white"
                aria-label="Clear search"
              >
                <X size={11} />
              </button>
            )}
          </label>
          <KindMenu value={kindFilter} onChange={setKindFilter} />
          <ViewButton active={view === "grid"} label="Grid view" onClick={() => setView("grid")}>
            <Grid2X2 size={13} />
          </ViewButton>
          <ViewButton active={view === "list"} label="List view" onClick={() => setView("list")}>
            <List size={14} />
          </ViewButton>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
        <aside className="library-folders flex gap-1 overflow-x-auto border-b border-white/[0.07] bg-[#0b0f14] px-2 py-2">
          <FolderButton
            active={folderFilter === "all"}
            label="All files"
            count={media.length}
            icon={<FolderOpen size={12} />}
            onClick={() => setFolderFilter("all")}
            onDrop={(event) => dropIntoFolder(event, null)}
          />
          <FolderButton
            active={folderFilter === "unfiled"}
            label="Unfiled"
            count={media.filter((asset) => !asset.folderId).length}
            icon={<FolderInput size={12} />}
            onClick={() => setFolderFilter("unfiled")}
            onDrop={(event) => dropIntoFolder(event, null)}
          />
          {folders.map((folder) => (
            <FolderButton
              key={folder.id}
              active={folderFilter === folder.id}
              label={folder.name}
              count={media.filter((asset) => asset.folderId === folder.id).length}
              color={folder.color}
              icon={<Folder size={12} />}
              onClick={() => setFolderFilter(folder.id)}
              onDrop={(event) => dropIntoFolder(event, folder.id)}
            />
          ))}
          {creatingFolder ? (
            <form
              className="mt-1"
              onSubmit={(event) => {
                event.preventDefault();
                submitFolder();
              }}
            >
              <input
                autoFocus
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                onBlur={() => !newFolderName.trim() && setCreatingFolder(false)}
                placeholder="Folder name"
                className="h-7 w-full rounded-md bg-white/[0.06] px-2 text-[9px] text-white outline-none ring-1 ring-[var(--timeline)]/40"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreatingFolder(true)}
              className="flex min-w-max items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-[9px] font-semibold text-[#667380] transition hover:bg-white/[0.04] hover:text-[#aab6c2]"
            >
              <Plus size={11} /> New folder
            </button>
          )}
        </aside>

        <section
          className={`min-h-0 overflow-y-auto p-2.5 ${dragOver ? "bg-[var(--timeline)]/[0.035]" : ""}`}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false);
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.files.length) return;
            event.preventDefault();
            setDragOver(false);
            void handleFiles(event.dataTransfer.files).then((assets) => {
              if (currentFolder && assets.length) {
                moveMediaToFolder(
                  assets.map((asset) => asset.id),
                  currentFolder.id
                );
              }
            });
          }}
        >
          {currentFolder && (
            <div className="mb-2 flex items-center gap-1.5 border-b border-white/[0.06] pb-2">
              {renamingFolder ? (
                <input
                  autoFocus
                  defaultValue={currentFolder.name}
                  onBlur={(event) => {
                    renameFolder(currentFolder.id, event.target.value);
                    setRenamingFolder(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") setRenamingFolder(false);
                  }}
                  className="min-w-0 flex-1 rounded-md bg-white/[0.05] px-2 py-1 text-[10px] font-semibold text-white outline-none ring-1 ring-[var(--timeline)]/45"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[#cfd7df]">
                  {currentFolder.name}
                </span>
              )}
              <button
                type="button"
                onClick={() => setRenamingFolder(true)}
                className="icon-button"
                title="Rename folder"
              >
                <Pencil size={10} />
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteFolder(currentFolder.id);
                  setFolderFilter("all");
                }}
                className="icon-button hover:!text-red-300"
                title="Delete folder; files become unfiled"
              >
                <Trash2 size={10} />
              </button>
            </div>
          )}

          {visible.length > 0 ? (
            <div className={view === "grid" ? "grid grid-cols-1 gap-2" : "space-y-1.5"}>
              {visible.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  compact={view === "list"}
                  selected={selectedIds.includes(asset.id)}
                  onTimeline={onTimeline.has(asset.id)}
                  onSelect={() => toggleSelected(asset.id)}
                  onDragStart={(event) => {
                    const ids = selectedIds.includes(asset.id) ? selectedIds : [asset.id];
                    if (!selectedIds.includes(asset.id)) setSelectedIds([asset.id]);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-captioncut-media", ids.join(","));
                  }}
                  onPair={
                    assetKind(asset) === "video" ? () => setPairingVideo(asset) : undefined
                  }
                  onAdd={() => {
                    const kind = assetKind(asset);
                    if (kind === "video") addMediaBatchToTimeline([asset.id]);
                    else if (kind === "audio") setMusicFromAsset(asset.id);
                    else addMediaToTrack(asset.id, "image");
                  }}
                />
              ))}
            </div>
          ) : (
            <LibraryEmpty
              hasMedia={media.length > 0}
              onImport={() => inputRef.current?.click()}
              folderName={currentFolder?.name}
            />
          )}
        </section>
      </div>

      {selectedIds.length > 0 && (
        <SelectionBar
          selected={selected}
          folders={folders}
          videoCount={selectedVideos.length}
          onClear={() => setSelectedIds([])}
          onMove={(folderId) => {
            moveMediaToFolder(selectedIds, folderId);
            addToast("success", `${selectedIds.length} ${selectedIds.length === 1 ? "file" : "files"} moved.`);
          }}
          onTimeline={() => addSelectionToTimeline(false)}
          onSmart={() => addSelectionToTimeline(true)}
        />
      )}

      {pairingVideo && (
        <PairAudioModal
          key={pairingVideo.id}
          video={pairingVideo}
          audios={media.filter((asset) => assetKind(asset) === "audio")}
          onClose={() => setPairingVideo(null)}
        />
      )}
    </div>
  );
}

function FolderButton({
  active,
  label,
  count,
  icon,
  color,
  onClick,
  onDrop,
}: {
  active: boolean;
  label: string;
  count: number;
  icon: React.ReactNode;
  color?: string;
  onClick: () => void;
  onDrop: (event: React.DragEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className={`group mb-0.5 flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-left transition ${
        active
          ? "bg-white/[0.075] text-[#e5ebf0] ring-1 ring-white/[0.08]"
          : "text-[#697583] hover:bg-white/[0.04] hover:text-[#aab5c0]"
      }`}
    >
      <span style={{ color }}>{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[9px] font-semibold">{label}</span>
      <span className="font-mono text-[8px] text-[#4f5a66]">{count}</span>
    </button>
  );
}

function AssetCard({
  asset,
  compact,
  selected,
  onTimeline,
  onSelect,
  onDragStart,
  onPair,
  onAdd,
}: {
  asset: MediaAsset;
  compact: boolean;
  selected: boolean;
  onTimeline: boolean;
  onSelect: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onPair?: () => void;
  onAdd: () => void;
}) {
  const kind = assetKind(asset);
  const analysis = useEditorStore((state) => state.analyses[asset.id]);
  const analyzing =
    kind !== "image" && analysis === undefined && asset.uploadState !== "uploading";

  return (
    <article
      draggable
      onDragStart={onDragStart}
      className={`library-card group relative overflow-hidden ${
        compact ? "flex items-center gap-2 p-1.5" : "p-1.5"
      } ${selected ? "library-card-selected" : ""}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className={`${compact ? "h-11 w-[72px]" : "aspect-video w-full"} relative shrink-0 overflow-hidden rounded-lg bg-[#080b10]`}
        aria-label={`${selected ? "Deselect" : "Select"} ${asset.originalName}`}
      >
        <AssetThumb asset={asset} />
        <span
          className={`absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-[5px] border transition ${
            selected
              ? "border-[var(--timeline)] bg-[var(--timeline)] text-[#071017]"
              : "border-white/30 bg-black/45 text-transparent group-hover:text-white/35"
          }`}
        >
          <Check size={10} strokeWidth={3} />
        </span>
        {onTimeline && (
          <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide text-[var(--caption)]">
            on timeline
          </span>
        )}
      </button>

      <div className={compact ? "min-w-0 flex-1" : "px-0.5 pb-0.5 pt-1.5"}>
        <p className="truncate text-[10px] font-semibold text-[#d8e0e7]" title={asset.originalName}>
          {asset.originalName}
        </p>
        <div className="mt-1 flex items-center gap-1 text-[8px] text-[#667381]">
          <KindIcon kind={kind} />
          <span>{kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Image"}</span>
          {kind !== "image" && <><span>·</span><span className="font-mono">{formatTime(asset.duration)}</span></>}
          {asset.uploadState === "uploading" && (
            <span
              className="ml-auto inline-flex items-center gap-1 text-[var(--cut)]"
              title="This file is ready to edit while its cloud copy syncs"
            >
              <CloudUpload size={9} className="animate-pulse" />
              {Math.round((asset.uploadProgress ?? 0) * 100)}%
            </span>
          )}
          {asset.uploadState === "error" && (
            <span
              className="ml-auto inline-flex items-center gap-1 text-rose-300"
              title={asset.uploadError ?? "Cloud sync failed"}
            >
              <AlertCircle size={9} /> local only
            </span>
          )}
          {analyzing && <span className="ml-auto animate-pulse text-[var(--timeline)]">analyzing</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-1 opacity-70 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" onClick={onAdd} className="asset-action">
            <Plus size={9} /> {kind === "video" ? "Sequence" : kind === "audio" ? "Music" : "Layer"}
          </button>
          {onPair && (
            <button type="button" onClick={onPair} className="asset-action">
              <Link2 size={9} /> Sync
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function AssetThumb({ asset }: { asset: MediaAsset }) {
  const kind = assetKind(asset);
  if (kind === "audio") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,rgba(99,217,198,.12),rgba(120,174,248,.08))] text-[var(--caption)]">
        <Music2 size={20} />
      </div>
    );
  }
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={mediaUrl(asset)} alt="" className="h-full w-full object-cover" draggable={false} />
    );
  }
  const local = localMediaUrl(asset.id);
  if (local) {
    return (
      <video
        src={local}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div
      className="h-full w-full bg-black bg-no-repeat"
      style={{
        backgroundImage: `url(${filmstripUrl(asset)})`,
        backgroundSize: "2000% 100%",
        backgroundPosition: `${(100 * 10) / 19}% 0`,
      }}
    />
  );
}

function KindIcon({ kind }: { kind: AssetKind }) {
  if (kind === "audio") return <Music2 size={9} />;
  if (kind === "image") return <ImageIcon size={9} />;
  return <Film size={9} />;
}

function KindMenu({
  value,
  onChange,
}: {
  value: KindFilter;
  onChange: (value: KindFilter) => void;
}) {
  return (
    <label className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as KindFilter)}
        className="h-8 appearance-none rounded-lg border-0 bg-[#080c11] pl-2.5 pr-6 text-[9px] font-semibold text-[#8995a2] outline-none ring-1 ring-white/[0.08] focus:ring-[var(--timeline)]/40"
        aria-label="Filter file type"
      >
        <option value="all">All</option>
        <option value="video">Video</option>
        <option value="audio">Audio</option>
        <option value="image">Image</option>
      </select>
      <ChevronDown
        size={10}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#596572]"
      />
    </label>
  );
}

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
        active ? "bg-white/[0.08] text-white" : "text-[#5e6a77] hover:bg-white/[0.04]"
      }`}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function SelectionBar({
  selected,
  folders,
  videoCount,
  onClear,
  onMove,
  onTimeline,
  onSmart,
}: {
  selected: MediaAsset[];
  folders: MediaFolder[];
  videoCount: number;
  onClear: () => void;
  onMove: (folderId: string | null) => void;
  onTimeline: () => void;
  onSmart: () => void;
}) {
  return (
    <div className="border-t border-[var(--timeline)]/20 bg-[#0b1117] p-2.5 shadow-[0_-10px_30px_rgba(0,0,0,.28)]">
      <div className="flex items-center gap-2">
        <span className="flex h-6 min-w-6 items-center justify-center rounded-lg bg-[var(--timeline)] text-[9px] font-extrabold text-[#071017]">
          {selected.length}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold text-[#d6dee5]">selected files</p>
          <p className="text-[8px] text-[#667381]">{videoCount} ready for the main track</p>
        </div>
        <button type="button" onClick={onClear} className="icon-button" aria-label="Clear selection">
          <X size={11} />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <label className="relative">
          <select
            defaultValue=""
            onChange={(event) => {
              if (!event.target.value) return;
              onMove(event.target.value === "__root" ? null : event.target.value);
              event.target.value = "";
            }}
            className="secondary-compact h-8 w-full appearance-none pr-6"
            aria-label="Move selected files"
          >
            <option value="" disabled>Move to…</option>
            <option value="__root">Unfiled</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
          <ChevronDown
            size={10}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#677482]"
          />
        </label>
        <button type="button" onClick={onTimeline} disabled={videoCount === 0} className="secondary-compact h-8 disabled:opacity-35">
          <Plus size={11} /> Timeline
        </button>
      </div>
      <button
        type="button"
        onClick={onSmart}
        disabled={videoCount === 0}
        className="mt-1.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[linear-gradient(100deg,var(--timeline),var(--caption))] text-[10px] font-extrabold text-[#071017] transition hover:brightness-110 disabled:opacity-35"
      >
        <Clapperboard size={12} /> Add + build montage
      </button>
    </div>
  );
}

function LibraryEmpty({
  hasMedia,
  onImport,
  folderName,
}: {
  hasMedia: boolean;
  onImport: () => void;
  folderName?: string;
}) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.09] px-5 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.04] text-[#667482] ring-1 ring-white/[0.07]">
        {hasMedia ? <Search size={16} /> : <FolderOpen size={16} />}
      </div>
      <p className="mt-3 text-[11px] font-semibold text-[#aeb9c4]">
        {hasMedia ? `Nothing in ${folderName ?? "this view"}` : "Your library is empty"}
      </p>
      <p className="mt-1 max-w-44 text-[9px] leading-relaxed text-[#5c6875]">
        {hasMedia
          ? "Change the folder or filter. You can drag files into any folder."
          : "Import video, audio, or images to begin."}
      </p>
      {!hasMedia && (
        <button type="button" onClick={onImport} className="secondary-compact mt-3 px-3">
          <Upload size={11} /> Choose files
        </button>
      )}
    </div>
  );
}
