import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Contrast,
  Download,
  Droplets,
  Eye,
  FileImage,
  ImagePlus,
  Layers3,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  ThermometerSun,
  Trash2,
  Upload,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import JSZip from "jszip";
import { thumbnailUrl } from "exifr";
import {
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  API_URL,
  checkBackend,
  createRawPreview,
  enhanceImages,
  type EnhanceResponse,
  type RoomResult,
} from "./api";
import {
  DEFAULT_EDITOR_SETTINGS,
  exportEditedImage,
  loadImageData,
  paintEditorCanvas,
  type EditorSettings,
} from "./editor";

const RAW_EXTENSIONS = [
  ".arw",
  ".cr2",
  ".cr3",
  ".dng",
  ".nef",
  ".orf",
  ".pef",
  ".raf",
  ".rw2",
  ".sr2",
  ".srf",
];
const ACCEPTED_TYPES = `image/*,${RAW_EXTENSIONS.join(",")}`;
const MAX_FILES = 12;

type PreviewState = "ready" | "loading" | "error";

type FileItem = {
  id: string;
  file: File;
  preview: string | null;
  previewState: PreviewState;
  objectUrl: boolean;
};

type DesignDirection = {
  id: string;
  title: string;
  description: string;
  insight: string;
  tone: EditorSettings;
};

type ViewMode = "enhanced" | "original";

type EditorSliderProps = {
  icon: ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  onChange: (value: number) => void;
};

function EditorSlider({ icon, label, value, min, max, step = 1, display, onChange }: EditorSliderProps) {
  return (
    <label className="editor-slider">
      <span className="editor-slider-label">{icon}<strong>{label}</strong></span>
      <span className="editor-slider-value">{display}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--editor-value": `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      />
    </label>
  );
}

const DESIGN_DIRECTIONS: DesignDirection[] = [
  {
    id: "gallery-neutral",
    title: "Gallery neutral",
    description: "Clean whites, quieter colour and balanced architectural contrast.",
    insight: "Best for mixed lighting and bright interiors",
    tone: { exposure: 0.04, contrast: 5, saturation: -4, warmth: -1 },
  },
  {
    id: "warm-residence",
    title: "Warm residence",
    description: "Soft daylight, natural timber and an inviting editorial warmth.",
    insight: "Best for cool or shadow-heavy rooms",
    tone: { exposure: 0.08, contrast: 3, saturation: 1, warmth: 7 },
  },
  {
    id: "architectural-calm",
    title: "Architectural calm",
    description: "Crisper structure with restrained, cool materials and deeper definition.",
    insight: "Best for warm casts and flat geometry",
    tone: { exposure: 0.02, contrast: 9, saturation: -7, warmth: -4 },
  },
];

function isRaw(file: File) {
  const name = file.name.toLowerCase();
  return RAW_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function isSupported(file: File) {
  return file.type.startsWith("image/") || isRaw(file);
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

function humanizeEngine(engine?: string) {
  if (!engine) return "AI relighting";
  return engine
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const editorCanvas = useRef<HTMLCanvasElement>(null);
  const filesRef = useRef<FileItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const strength = 0.82;
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processingStageLabel, setProcessingStageLabel] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnhanceResponse | null>(null);
  const [activeRoomIndex, setActiveRoomIndex] = useState(0);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("enhanced");
  const [editorSource, setEditorSource] = useState<ImageData | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const [activeDirectionId, setActiveDirectionId] = useState<string | null>(null);

  const roomResults = result?.results ?? [];
  const activeRoom: RoomResult | null = roomResults[activeRoomIndex] ?? null;
  const activeImageUrl = activeRoom?.enhanced_image_url ?? result?.enhanced_image_url ?? null;
  const activeOriginalUrl = activeRoom?.original_preview_url ?? originalUrl;
  const activeOriginals = useMemo(() => {
    const grouped = (activeRoom?.source_indices ?? [])
      .map((index) => files[index])
      .filter((item): item is FileItem => Boolean(item?.preview))
      .map((item) => ({ url: item.preview as string, name: item.file.name }));
    if (grouped.length) return grouped;
    return activeOriginalUrl ? [{ url: activeOriginalUrl, name: activeRoom?.master_filename ?? "Original" }] : [];
  }, [activeOriginalUrl, activeRoom?.master_filename, activeRoom?.source_indices, files]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    void checkBackend().then(setBackendOnline);
  }, []);

  useEffect(() => {
    if (!processing) return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [processing]);

  useEffect(
    () => () => {
      filesRef.current.forEach((item) => {
        if (item.objectUrl && item.preview) URL.revokeObjectURL(item.preview);
      });
    },
    [],
  );

  useEffect(() => {
    if (!activeImageUrl) {
      setEditorSource(null);
      return;
    }
    let active = true;
    setEditorLoading(true);
    void loadImageData(activeImageUrl, 1800)
      .then((source) => {
        if (active) setEditorSource(source);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not open the finishing editor.");
        }
      })
      .finally(() => {
        if (active) setEditorLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeImageUrl]);

  useEffect(() => {
    if (!editorSource || !editorCanvas.current || viewMode !== "enhanced") return;
    const frame = window.requestAnimationFrame(() => {
      if (editorCanvas.current) {
        paintEditorCanvas(editorCanvas.current, editorSource, editorSettings);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorSource, editorSettings, viewMode]);
  const recommendedDirectionId = useMemo(() => {
    const colourCast = activeRoom?.colour_cast_ratio ?? result?.colour_cast_ratio ?? 1;
    const saturation = activeRoom?.mean_saturation ?? result?.mean_saturation ?? 0;
    const median = activeRoom?.median_luminance ?? result?.median_luminance ?? 0.5;
    const dark = activeRoom?.dark_fraction ?? result?.dark_fraction ?? 0;
    if (colourCast > 1.18 || saturation > 82) {
      return "architectural-calm";
    }
    if (median < 0.42 || dark > 0.32) {
      return "warm-residence";
    }
    return "gallery-neutral";
  }, [activeRoom, result?.colour_cast_ratio, result?.dark_fraction, result?.mean_saturation, result?.median_luminance]);

  const totalSize = useMemo(
    () => files.reduce((sum, item) => sum + item.file.size, 0),
    [files],
  );
  const previewLoading = files.some((item) => item.previewState === "loading");
  const hasRawFiles = files.some((item) => isRaw(item.file));

  const loadRawPreview = useCallback(async (id: string, file: File) => {
    try {
      // ARW and most camera RAW files commonly contain a browser-displayable
      // JPEG thumbnail. Extract it locally first so choosing files does not
      // immediately upload the full RAW merely to draw an upload card.
      const localPreview = await thumbnailUrl(file).catch(() => undefined);
      const preview = localPreview ?? await createRawPreview(file);
      setFiles((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, preview, previewState: "ready", objectUrl: Boolean(localPreview) }
            : item,
        ),
      );
    } catch (previewError) {
      setFiles((current) =>
        current.map((item) =>
          item.id === id ? { ...item, previewState: "error" } : item,
        ),
      );
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Could not prepare the RAW preview.",
      );
    }
  }, []);

  const addFiles = useCallback(
    (incoming: File[]) => {
      setError(null);
      setResult(null);
      setActiveRoomIndex(0);
      const supported = incoming.filter(isSupported);
      if (supported.length !== incoming.length) {
        setError("One or more files were not a supported image or camera RAW format.");
      }

      const slots = Math.max(0, MAX_FILES - filesRef.current.length);
      const additions = supported.slice(0, slots).map<FileItem>((file) => {
        const raw = isRaw(file);
        return {
          id: crypto.randomUUID(),
          file,
          preview: raw ? null : URL.createObjectURL(file),
          previewState: raw ? "loading" : "ready",
          objectUrl: !raw,
        };
      });

      if (supported.length > slots) {
        setError(`A maximum of ${MAX_FILES} source frames can be processed together.`);
      }

      filesRef.current = [...filesRef.current, ...additions];
      setFiles(filesRef.current);
      additions
        .filter((item) => isRaw(item.file))
        .forEach((item) => void loadRawPreview(item.id, item.file));
    },
    [loadRawPreview],
  );

  const removeFile = (id: string) => {
    const target = filesRef.current.find((item) => item.id === id);
    if (target?.objectUrl && target.preview) URL.revokeObjectURL(target.preview);
    filesRef.current = filesRef.current.filter((item) => item.id !== id);
    setFiles(filesRef.current);
    setResult(null);
    setActiveRoomIndex(0);
    setOriginalUrl(null);
    setError(null);
  };

  const clearAll = () => {
    filesRef.current.forEach((item) => {
      if (item.objectUrl && item.preview) URL.revokeObjectURL(item.preview);
    });
    filesRef.current = [];
    setFiles([]);
    setResult(null);
    setActiveRoomIndex(0);
    setOriginalUrl(null);
    setError(null);
    setViewMode("enhanced");
    setEditorSettings(DEFAULT_EDITOR_SETTINGS);
    setActiveDirectionId(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const runEnhancement = async () => {
    if (!files.length || previewLoading) return;
    setError(null);
    setResult(null);
    setActiveRoomIndex(0);
    setActiveDirectionId(null);
    setProcessingStageLabel("Uploading source files");
    setProcessing(true);

    try {
      const response = await enhanceImages(
        files.map((item) => item.file),
        strength,
        setProcessingStageLabel,
      );
      setOriginalUrl(files[0].preview || response.original_preview_url || null);
      setResult(response);
      setActiveRoomIndex(0);
      setViewMode("enhanced");
      setEditorSettings(DEFAULT_EDITOR_SETTINGS);
      window.setTimeout(
        () => document.getElementById("result")?.scrollIntoView({ behavior: "smooth" }),
        100,
      );
    } catch (enhanceError) {
      setError(
        enhanceError instanceof Error
          ? enhanceError.message
          : "Enhancement failed. Please try again.",
      );
      setBackendOnline(await checkBackend());
    } finally {
      setProcessing(false);
      setProcessingStageLabel(null);
    }
  };

  const downloadResult = async () => {
    if (!activeImageUrl) return;
    setDownloading(true);
    try {
      const blob = await exportEditedImage(
        activeImageUrl,
        editorSettings,
        null,
        {},
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `auroraai-${Date.now()}.jpg`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Could not export the edited image.");
    } finally {
      setDownloading(false);
    }
  };

  const downloadAllResults = async () => {
    if (!roomResults.length || downloadingAll) return;
    setDownloadingAll(true);
    try {
      const archive = new JSZip();
      await Promise.all(
        roomResults.map(async (room, index) => {
          const response = await fetch(room.enhanced_image_url);
          if (!response.ok) throw new Error(`Could not download ${room.label}.`);
          archive.file(`auroraai-scene-${String(index + 1).padStart(2, "0")}.jpg`, await response.blob());
        }),
      );
      const blob = await archive.generateAsync({ type: "blob", compression: "DEFLATE" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `auroraai-all-scenes-${Date.now()}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Could not download all scene images.");
    } finally {
      setDownloadingAll(false);
    }
  };

  const updateEditor = <Key extends keyof EditorSettings>(key: Key, value: EditorSettings[Key]) => {
    setEditorSettings((current) => ({ ...current, [key]: value }));
    setActiveDirectionId(null);
    setViewMode("enhanced");
  };

  const resetEditor = () => {
    setEditorSettings(DEFAULT_EDITOR_SETTINGS);
    setViewMode("enhanced");
    setActiveDirectionId(null);
  };

  const applyDesignDirection = (direction: DesignDirection) => {
    setEditorSettings(direction.tone);
    setActiveDirectionId(direction.id);
    setViewMode("enhanced");
  };

  const selectRoom = (index: number) => {
    if (index < 0 || index >= roomResults.length || index === activeRoomIndex) return;
    setActiveRoomIndex(index);
    setViewMode("enhanced");
    setEditorSettings(DEFAULT_EDITOR_SETTINGS);
    setActiveDirectionId(null);
  };

  const processingLabel =
    elapsed < 8
      ? hasRawFiles
        ? "Decoding camera RAW data"
        : files.length > 1
          ? "Analysing and grouping scenes"
          : "Analysing image and exposure"
      : elapsed < 28
        ? "Recovering exposure"
        : elapsed < 55
          ? "Balancing light and colour"
          : "Finishing detail and texture";
  const processingStage = elapsed < 8 ? 0 : elapsed < 28 ? 1 : elapsed < 55 ? 2 : 3;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="AuroraAI home">
          <span className="brand-mark"><Sparkles size={17} strokeWidth={2.2} /></span>
          <span>AuroraAI</span>
          <span className="brand-edition">STUDIO</span>
        </a>
        <div className="header-actions">
          <div className={`status-pill ${backendOnline === false ? "offline" : ""}`}>
            <span className="status-dot" />
            {backendOnline === null
              ? "Checking engine"
              : backendOnline
                ? "Enhancement engine online"
                : "Engine offline"}
          </div>
          <a className="docs-link" href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
            API <ArrowUpRight size={14} />
          </a>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-aurora" aria-hidden="true"><i /><i /><i /></div>
          <div className="eyebrow"><span /> AURORA IMAGING ENGINE · RAW READY</div>
          <h1>Turn difficult light<br /><em>into atmosphere.</em></h1>
          <p>
            A considered AI imaging studio for interiors—recovering natural light,
            protecting material detail, and revealing only edits it can trust.
          </p>
          <div className="hero-proof">
            <span><ShieldCheck size={15} /> Local-quality processing</span>
            <span><Layers3 size={15} /> Multi-frame aware</span>
            <span><Zap size={15} /> Full-resolution output</span>
          </div>
        </section>

        {processing && (
          <div className="processing-veil" role="status" aria-live="polite">
            <div className="aurora-loader-card">
              <div className="loader-art" aria-hidden="true">
                <span className="loader-halo halo-one" />
                <span className="loader-halo halo-two" />
                <span className="loader-core"><Sparkles size={24} /></span>
                <span className="loader-scan" />
              </div>
              <div className="loader-copy">
                <span className="loader-kicker">AURORA NEURAL PIPELINE</span>
                <h2>{processingStageLabel ?? processingLabel}</h2>
                <p>{files.length > 1 ? "Exposure brackets from each fixed viewpoint are enhanced and composited. Different viewpoints remain separate results." : "Your image stays in full resolution while light, colour and texture are resolved in separate passes."}</p>
                <div className="loader-stages">
                  {[(hasRawFiles ? "Decode RAW" : files.length > 1 ? "Group scenes" : "Analyse"), "Relight", "Balance", "Finish"].map((stage, index) => (
                    <div className={index < processingStage ? "done" : index === processingStage ? "active" : ""} key={stage}>
                      <span>{index < processingStage ? <Check size={11} /> : index + 1}</span>
                      <small>{stage}</small>
                    </div>
                  ))}
                </div>
                <div className="loader-meta"><span>{formatTime(elapsed)} elapsed</span><span>Keep this tab open</span></div>
              </div>
            </div>
          </div>
        )}

        <section className="studio-panel" aria-label="Enhancement studio">
          <div className="studio-heading">
            <div>
              <span className="section-index">01</span>
              <h2>Source images</h2>
              <p>Upload exposures and viewpoints freely. AuroraAI creates one best-area composite per fixed camera scene.</p>
            </div>
            {files.length > 0 && (
              <button className="text-button" type="button" onClick={clearAll}>
                <Trash2 size={14} /> Clear session
              </button>
            )}
          </div>

          <div
            className={`drop-zone ${dragging ? "is-dragging" : ""} ${files.length ? "has-files" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDragging(false);
            }}
            onDrop={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              setDragging(false);
              addFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_TYPES}
              multiple
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <button
              className="drop-action"
              type="button"
              onClick={() => fileInput.current?.click()}
              aria-label="Choose images"
            >
              <span className="upload-orbit"><Upload size={25} /></span>
              <span className="drop-copy">
                <strong>{dragging ? "Release to add images" : "Drop difficult images here"}</strong>
                <small>or browse JPEG, PNG and camera RAW · up to {MAX_FILES} frames</small>
              </span>
              <span className="browse-chip">Choose files <ChevronRight size={15} /></span>
            </button>
          </div>

          {files.length > 0 && (
            <div className="file-tray">
              <div className="file-tray-meta">
                <span>{files.length} {files.length === 1 ? "source" : "sources"}</span>
                <span>{formatBytes(totalSize)}</span>
              </div>
              <div className="file-grid">
                {files.map((item, index) => (
                  <article className="file-card" key={item.id}>
                    <div className="file-preview">
                      {item.preview ? (
                        <img src={item.preview} alt={`Preview of ${item.file.name}`} />
                      ) : item.previewState === "loading" ? (
                        <LoaderCircle className="spin" size={22} />
                      ) : (
                        <FileImage size={24} />
                      )}
                      {isRaw(item.file) && <span className="raw-badge">RAW</span>}
                    </div>
                    <div className="file-info">
                      <strong title={item.file.name}>{item.file.name}</strong>
                      <span>
                        {item.previewState === "loading" ? "Preparing preview…" : formatBytes(item.file.size)}
                      </span>
                    </div>
                    <button type="button" onClick={() => removeFile(item.id)} aria-label={`Remove ${item.file.name}`}>
                      <X size={15} />
                    </button>
                  </article>
                ))}
                {files.length < MAX_FILES && (
                  <button className="add-more" type="button" onClick={() => fileInput.current?.click()}>
                    <ImagePlus size={19} /><span>Add frame</span>
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="control-deck compact-action-deck">
            {error && (
              <div className="error-banner" role="alert">
                <CircleAlert size={18} /><span>{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X size={15} /></button>
              </div>
            )}

            <button
              className="enhance-button"
              type="button"
              disabled={!files.length || previewLoading || processing}
              onClick={() => void runEnhancement()}
            >
              {processing ? <LoaderCircle className="spin" size={19} /> : <WandSparkles size={19} />}
              <span>
                <strong>{processing ? (processingStageLabel ?? processingLabel) : "Enhance with AuroraAI"}</strong>
                <small>
                  {processing
                    ? `${formatTime(elapsed)} elapsed · keep this tab open`
                    : files.length
                      ? `${files.length} ${files.length === 1 ? "frame" : "frames"} ready`
                      : "Add an image to begin"}
                </small>
              </span>
              {!processing && <ArrowDown size={18} />}
            </button>
          </div>
        </section>

        {activeImageUrl && activeOriginalUrl && (
          <section className="result-section" id="result">
            <div className="result-heading">
              <div>
                <span className="section-index">02</span>
                <h2>{roomResults.length > 1 ? `Finish ${activeRoom?.label ?? "your scene"}` : "Finish your image"}</h2>
                <p>
                  {roomResults.length > 1
                    ? `${roomResults.length} camera scenes found. Use the scene slider to open each final composite.`
                    : "AuroraAI enhanced every source and combined only the best safely registered areas."}
                </p>
              </div>
              <div className="view-switch" aria-label="Preview version">
                <button
                  className={viewMode === "original" ? "active" : ""}
                  type="button"
                  onClick={() => setViewMode("original")}
                >
                  <Eye size={14} /> Original
                </button>
                <button
                  className={viewMode === "enhanced" ? "active" : ""}
                  type="button"
                  onClick={() => setViewMode("enhanced")}
                >
                  <Sparkles size={14} /> Enhanced
                </button>
              </div>
            </div>

            {roomResults.length > 1 && (
              <div className="room-carousel" aria-label="Completed scene results">
                <button
                  className="room-carousel-arrow"
                  type="button"
                  disabled={activeRoomIndex === 0}
                  onClick={() => selectRoom(activeRoomIndex - 1)}
                  aria-label="Previous scene"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="room-carousel-track">
                  {roomResults.map((room, index) => (
                    <button
                      type="button"
                      className={`room-result-tab ${index === activeRoomIndex ? "active" : ""}`}
                      key={room.room_id}
                      onClick={() => selectRoom(index)}
                    >
                      <span className="room-tab-index">{String(index + 1).padStart(2, "0")}</span>
                      <span>
                        <strong>{room.label}</strong>
                        <small>{room.input_frames} {room.input_frames === 1 ? "source" : "room sources"} · final composite</small>
                      </span>
                      {index === activeRoomIndex && <Sparkles size={15} />}
                    </button>
                  ))}
                </div>
                <button
                  className="room-carousel-arrow"
                  type="button"
                  disabled={activeRoomIndex === roomResults.length - 1}
                  onClick={() => selectRoom(activeRoomIndex + 1)}
                  aria-label="Next scene"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            )}

            <div className="finishing-workspace">
              <div className="editor-stage">
                {viewMode === "original" ? (
                  <div className={`original-grid ${activeOriginals.length === 1 ? "single" : ""}`}>
                    {activeOriginals.map((source, index) => (
                      <figure key={`${source.name}-${index}`}>
                        <img src={source.url} alt={`${activeRoom?.label ?? "Scene"} original ${index + 1}`} />
                        <figcaption><span>Source {String(index + 1).padStart(2, "0")}</span><strong>{source.name}</strong></figcaption>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <>
                    <canvas ref={editorCanvas} aria-label="Enhanced image editor preview" />
                    {editorLoading && (
                      <div className="editor-loading"><LoaderCircle className="spin" size={22} /> Preparing editor</div>
                    )}
                  </>
                )}
                <span className="editor-version-label">
                  {viewMode === "original" ? `${activeOriginals.length} original ${activeOriginals.length === 1 ? "source" : "sources"}` : "Enhanced"}
                </span>
              </div>

              <aside className="finish-panel">
                <div className="finish-panel-heading">
                  <span><WandSparkles size={16} /></span>
                  <div><strong>Aurora directions</strong><small>One decision, coordinated edits</small></div>
                  <button type="button" onClick={resetEditor} aria-label="Reset all edits"><RotateCcw size={15} /></button>
                </div>

                <p className="directions-intro">Choose a coordinated whole-image finish, or tune it directly below.</p>

                <div className="direction-list">
                    {[...DESIGN_DIRECTIONS]
                      .sort((a, b) => Number(b.id === recommendedDirectionId) - Number(a.id === recommendedDirectionId))
                      .map((direction, index) => {
                        const isRecommended = direction.id === recommendedDirectionId;
                        const isActive = direction.id === activeDirectionId;
                        return (
                          <button
                            className={`direction-card ${isRecommended ? "recommended" : ""} ${isActive ? "active" : ""}`}
                            type="button"
                            key={direction.id}
                            onClick={() => applyDesignDirection(direction)}
                          >
                            <span className="direction-number">0{index + 1}</span>
                            <span className="direction-copy">
                              <span className="direction-title-row">
                                <strong>{direction.title}</strong>
                                {isRecommended && <small>AI PICK</small>}
                              </span>
                              <span>{direction.description}</span>
                              <em>{direction.insight} · whole-image finish</em>
                            </span>
                            <span className="direction-action">{isActive ? <Check size={14} /> : <ChevronRight size={14} />}</span>
                          </button>
                        );
                      })}
                </div>

                <details className="advanced-editor" open>
                  <summary>
                    <span><SlidersHorizontal size={15} /></span>
                    <span><strong>Advanced controls</strong><small>Exposure, contrast, colour and warmth</small></span>
                    <ChevronRight className="advanced-chevron" size={15} />
                  </summary>
                  <div className="advanced-editor-body">
                <div className="editor-controls">
                  <EditorSlider
                    icon={<SunMedium size={15} />}
                    label="Exposure"
                    value={editorSettings.exposure}
                    min={-1}
                    max={1}
                    step={0.05}
                    display={`${editorSettings.exposure > 0 ? "+" : ""}${editorSettings.exposure.toFixed(2)} EV`}
                    onChange={(value) => updateEditor("exposure", value)}
                  />
                  <EditorSlider
                    icon={<Contrast size={15} />}
                    label="Contrast"
                    value={editorSettings.contrast}
                    min={-30}
                    max={30}
                    display={`${editorSettings.contrast > 0 ? "+" : ""}${editorSettings.contrast}`}
                    onChange={(value) => updateEditor("contrast", value)}
                  />
                  <EditorSlider
                    icon={<Droplets size={15} />}
                    label="Saturation"
                    value={editorSettings.saturation}
                    min={-30}
                    max={30}
                    display={`${editorSettings.saturation > 0 ? "+" : ""}${editorSettings.saturation}`}
                    onChange={(value) => updateEditor("saturation", value)}
                  />
                  <EditorSlider
                    icon={<ThermometerSun size={15} />}
                    label="Warmth"
                    value={editorSettings.warmth}
                    min={-40}
                    max={40}
                    display={`${editorSettings.warmth > 0 ? "+" : ""}${editorSettings.warmth}`}
                    onChange={(value) => updateEditor("warmth", value)}
                  />
                </div>

                  </div>
                </details>

              </aside>
            </div>

            <div className="result-footer">
              <div className="diagnostics">
                <div><span>Engine</span><strong>{humanizeEngine(activeRoom?.engine ?? result?.engine)}</strong></div>
                <div><span>Source</span><strong>{(activeRoom?.raw_input ?? result?.raw_input) ? "Camera RAW" : "Standard image"}</strong></div>
                <div><span>Scene sources</span><strong>{activeRoom?.input_frames ?? result?.input_frames ?? files.length}</strong></div>
                <div><span>Fusion</span><strong>{(activeRoom?.fused_frames ?? result?.fused_frames ?? 1) > 1 ? `${activeRoom?.fused_frames ?? result?.fused_frames} registered` : "Canonical view"}</strong></div>
                <div><span>Strength</span><strong>{Math.round((result?.strength ?? strength) * 100)}%</strong></div>
              </div>
              <div className="result-actions">
                <button className="secondary-button" type="button" onClick={clearAll}>
                  <RefreshCw size={17} /> New image
                </button>
                {roomResults.length > 1 && (
                  <button className="secondary-button" type="button" onClick={() => void downloadAllResults()} disabled={downloadingAll}>
                    {downloadingAll ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
                    {downloadingAll ? "Building ZIP…" : "Download all"}
                  </button>
                )}
                <button className="download-button" type="button" onClick={() => void downloadResult()} disabled={downloading}>
                  {downloading ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
                  {downloading ? "Rendering full quality…" : "Download this image"}
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="quality-strip">
          <div><span>01</span><strong>Exposure recovery</strong><p>Adaptive shadow lift without flattening the frame.</p></div>
          <div><span>02</span><strong>Colour intelligence</strong><p>Neutral whites and restrained saturation by design.</p></div>
          <div><span>03</span><strong>Detail finish</strong><p>Texture-aware cleanup for a natural final image.</p></div>
        </section>
      </main>

      <footer>
        <div className="brand compact-brand"><span className="brand-mark"><Sparkles size={15} /></span><span>AuroraAI</span></div>
        <p>Prototype AI relighting studio · Research use only</p>
        <span>Engine: {API_URL.replace(/^https?:\/\//, "")}</span>
      </footer>
    </div>
  );
}

export default App;
