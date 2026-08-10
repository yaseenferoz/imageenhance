import {
  ArrowDown,
  ArrowUpRight,
  Check,
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
  Palette,
  RefreshCw,
  RotateCcw,
  ScanSearch,
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
  analyzeScene,
  checkBackend,
  createRawPreview,
  enhanceImages,
  type EnhanceResponse,
  type SceneAnalysisResponse,
  type SceneRegion,
} from "./api";
import {
  DEFAULT_EDITOR_SETTINGS,
  exportEditedImage,
  loadImageData,
  loadSegmentMap,
  paintEditorCanvas,
  type EditorSettings,
  type RegionEdits,
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
const MAX_FILES = 6;

type PreviewState = "ready" | "loading" | "error";

type FileItem = {
  id: string;
  file: File;
  preview: string | null;
  previewState: PreviewState;
  objectUrl: boolean;
};

type Preset = {
  label: string;
  description: string;
  value: number;
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

const PRESETS: Preset[] = [
  { label: "Natural", description: "Quiet, realistic lift", value: 0.64 },
  { label: "Balanced", description: "Detail with presence", value: 0.82 },
  { label: "Daylight", description: "Maximum recovery", value: 1 },
];

const OBJECT_COLORS = ["#f0eadf", "#d9c7ad", "#c8d0c3", "#8ea19d", "#b9aa9e", "#77736d"];

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
  const [strength, setStrength] = useState(0.82);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [processing, setProcessing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnhanceResponse | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("enhanced");
  const [editorSource, setEditorSource] = useState<ImageData | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const [sceneAnalysis, setSceneAnalysis] = useState<SceneAnalysisResponse | null>(null);
  const [sceneLoading, setSceneLoading] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [segmentMap, setSegmentMap] = useState<Uint8Array | null>(null);
  const [regionEdits, setRegionEdits] = useState<RegionEdits>({});
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);

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
    if (!result?.enhanced_image_url) {
      setEditorSource(null);
      return;
    }
    let active = true;
    setEditorLoading(true);
    void loadImageData(result.enhanced_image_url, 1800)
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
  }, [result?.enhanced_image_url]);

  useEffect(() => {
    if (!result?.enhanced_image_url) {
      setSceneAnalysis(null);
      setSceneError(null);
      setSegmentMap(null);
      return;
    }
    let active = true;
    setSceneLoading(true);
    setSceneError(null);
    void analyzeScene(result.enhanced_image_url)
      .then((analysis) => {
        if (!active) return;
        setSceneAnalysis(analysis);
        setRegionEdits(Object.fromEntries(
          analysis.regions.map((region) => [
            region.id,
            { color: region.current_color, amount: 58, enabled: false },
          ]),
        ));
        const preferred = analysis.regions.find((region) => region.label === "Wall") ?? analysis.regions[0];
        setSelectedRegionId(preferred?.id ?? null);
      })
      .catch((analysisError) => {
        if (active) {
          setSceneError(analysisError instanceof Error ? analysisError.message : "AI scene detection failed.");
        }
      })
      .finally(() => {
        if (active) setSceneLoading(false);
      });
    return () => {
      active = false;
    };
  }, [result?.enhanced_image_url]);

  useEffect(() => {
    if (!sceneAnalysis?.mask_url || !editorSource) {
      setSegmentMap(null);
      return;
    }
    let active = true;
    void loadSegmentMap(sceneAnalysis.mask_url, editorSource.width, editorSource.height)
      .then((map) => {
        if (active) setSegmentMap(map);
      })
      .catch((maskError) => {
        if (active) setSceneError(maskError instanceof Error ? maskError.message : "Could not load AI object masks.");
      });
    return () => {
      active = false;
    };
  }, [editorSource, sceneAnalysis?.mask_url]);

  useEffect(() => {
    if (!editorSource || !editorCanvas.current || viewMode !== "enhanced") return;
    const frame = window.requestAnimationFrame(() => {
      if (editorCanvas.current) {
        paintEditorCanvas(editorCanvas.current, editorSource, editorSettings, segmentMap, regionEdits);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorSource, editorSettings, segmentMap, regionEdits, viewMode]);

  const activeRegion: SceneRegion | null = useMemo(
    () => sceneAnalysis?.regions.find((region) => region.id === selectedRegionId) ?? null,
    [sceneAnalysis, selectedRegionId],
  );
  const activeRegionEdit = activeRegion ? regionEdits[activeRegion.id] : undefined;
  const editedRegionCount = Object.values(regionEdits).filter((edit) => edit.enabled).length;

  const totalSize = useMemo(
    () => files.reduce((sum, item) => sum + item.file.size, 0),
    [files],
  );
  const previewLoading = files.some((item) => item.previewState === "loading");

  const loadRawPreview = useCallback(async (id: string, file: File) => {
    try {
      const preview = await createRawPreview(file);
      setFiles((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, preview, previewState: "ready" }
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
    setOriginalUrl(null);
    setError(null);
    setViewMode("enhanced");
    setEditorSettings(DEFAULT_EDITOR_SETTINGS);
    setSceneAnalysis(null);
    setSceneError(null);
    setSegmentMap(null);
    setRegionEdits({});
    setSelectedRegionId(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const runEnhancement = async () => {
    if (!files.length || previewLoading) return;
    setError(null);
    setResult(null);
    setSceneAnalysis(null);
    setSceneError(null);
    setSegmentMap(null);
    setRegionEdits({});
    setSelectedRegionId(null);
    setProcessing(true);

    try {
      const response = await enhanceImages(
        files.map((item) => item.file),
        strength,
      );
      setOriginalUrl(files[0].preview || response.original_preview_url || null);
      setResult(response);
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
    }
  };

  const downloadResult = async () => {
    if (!result?.enhanced_image_url) return;
    setDownloading(true);
    try {
      const blob = await exportEditedImage(
        result.enhanced_image_url,
        editorSettings,
        sceneAnalysis?.mask_url ?? null,
        regionEdits,
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

  const updateEditor = <Key extends keyof EditorSettings>(key: Key, value: EditorSettings[Key]) => {
    setEditorSettings((current) => ({ ...current, [key]: value }));
    setViewMode("enhanced");
  };

  const resetEditor = () => {
    setEditorSettings(DEFAULT_EDITOR_SETTINGS);
    setRegionEdits(Object.fromEntries(
      (sceneAnalysis?.regions ?? []).map((region) => [
        region.id,
        { color: region.current_color, amount: 58, enabled: false },
      ]),
    ));
    setViewMode("enhanced");
  };

  const updateRegionEdit = (regionId: number, patch: Partial<RegionEdits[number]>) => {
    setRegionEdits((current) => ({
      ...current,
      [regionId]: { ...current[regionId], ...patch },
    }));
    setViewMode("enhanced");
  };

  const processingLabel =
    elapsed < 8
      ? "Reading camera data"
      : elapsed < 28
        ? "Recovering exposure"
        : elapsed < 55
          ? "Balancing light and colour"
          : "Finishing detail and texture";

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
          <div className="eyebrow"><span /> AI RELIGHTING · RAW READY</div>
          <h1>Light, <em>resolved.</em></h1>
          <p>
            Recover shadow detail, calm harsh highlights, and finish difficult
            frames with a natural, camera-aware grade.
          </p>
          <div className="hero-proof">
            <span><ShieldCheck size={15} /> Local-quality processing</span>
            <span><Layers3 size={15} /> Multi-frame aware</span>
            <span><Zap size={15} /> Full-resolution output</span>
          </div>
        </section>

        <section className="studio-panel" aria-label="Enhancement studio">
          <div className="studio-heading">
            <div>
              <span className="section-index">01</span>
              <h2>Source images</h2>
              <p>Use one image, or add aligned exposures for richer recovery.</p>
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
                      {index === 0 && <span className="anchor-badge">Anchor</span>}
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

          <div className="control-deck">
            <div className="studio-heading compact">
              <div>
                <span className="section-index">02</span>
                <h2>Choose the finish</h2>
                <p>The engine still protects images that need little correction.</p>
              </div>
              <div className="strength-readout">
                <strong>{Math.round(strength * 100)}</strong><span>%</span>
              </div>
            </div>

            <div className="preset-grid">
              {PRESETS.map((preset) => (
                <button
                  className={Math.abs(strength - preset.value) < 0.01 ? "active" : ""}
                  type="button"
                  key={preset.label}
                  onClick={() => setStrength(preset.value)}
                >
                  <span className="preset-check"><Check size={13} /></span>
                  <strong>{preset.label}</strong>
                  <small>{preset.description}</small>
                </button>
              ))}
            </div>
            <label className="strength-slider">
              <span>Relighting intensity</span>
              <input
                type="range"
                min="0.35"
                max="1"
                step="0.01"
                value={strength}
                onChange={(event) => setStrength(Number(event.target.value))}
                style={{ "--value": `${((strength - 0.35) / 0.65) * 100}%` } as CSSProperties}
              />
              <span>35</span><span>100</span>
            </label>

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
                <strong>{processing ? processingLabel : "Enhance with AuroraAI"}</strong>
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

        {result?.enhanced_image_url && originalUrl && (
          <section className="result-section" id="result">
            <div className="result-heading">
              <div>
                <span className="section-index">03</span>
                <h2>Finish your image</h2>
                <p>AI maps the room automatically. Choose any detected surface or object to recolour it.</p>
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

            <div className="finishing-workspace">
              <div className="editor-stage">
                {viewMode === "original" ? (
                  <img src={originalUrl} alt="Original image" />
                ) : (
                  <>
                    <canvas ref={editorCanvas} aria-label="Enhanced image editor preview" />
                    {editorLoading && (
                      <div className="editor-loading"><LoaderCircle className="spin" size={22} /> Preparing editor</div>
                    )}
                    {sceneLoading && (
                      <div className="scene-scanning"><ScanSearch size={18} /> AI mapping walls and furniture</div>
                    )}
                  </>
                )}
                <span className="editor-version-label">
                  {viewMode === "original" ? "Original" : editedRegionCount ? `Enhanced · ${editedRegionCount} AI edits` : "Enhanced"}
                </span>
              </div>

              <aside className="finish-panel">
                <div className="finish-panel-heading">
                  <span><SlidersHorizontal size={16} /></span>
                  <div><strong>Fine tune</strong><small>Subtle finishing controls</small></div>
                  <button type="button" onClick={resetEditor} aria-label="Reset all edits"><RotateCcw size={15} /></button>
                </div>

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

                <div className="ai-object-tool">
                  <div className="wall-tool-title">
                    <span><ScanSearch size={16} /></span>
                    <div><strong>AI room map</strong><small>No manual selection required</small></div>
                  </div>
                  {sceneLoading ? (
                    <div className="ai-map-state"><LoaderCircle className="spin" size={18} /><span>Detecting editable objects…</span></div>
                  ) : sceneError ? (
                    <div className="ai-map-error"><CircleAlert size={16} /><span>{sceneError}</span></div>
                  ) : sceneAnalysis?.regions.length ? (
                    <>
                      <div className="detected-regions" aria-label="AI detected editable objects">
                        {sceneAnalysis.regions.map((region) => (
                          <button
                            key={region.id}
                            type="button"
                            className={`${selectedRegionId === region.id ? "active" : ""} ${regionEdits[region.id]?.enabled ? "edited" : ""}`}
                            onClick={() => setSelectedRegionId(region.id)}
                          >
                            <span className="region-colour" style={{ backgroundColor: regionEdits[region.id]?.color ?? region.current_color }} />
                            <span>{region.label}</span>
                            <small>{Math.max(1, Math.round(region.area_fraction * 100))}%</small>
                          </button>
                        ))}
                      </div>
                      {activeRegion && activeRegionEdit && (
                        <div className="region-colour-editor">
                          <div className="region-editor-title">
                            <span>Change {activeRegion.label}</span>
                            {activeRegionEdit.enabled && (
                              <button type="button" onClick={() => updateRegionEdit(activeRegion.id, { enabled: false })}>Reset colour</button>
                            )}
                          </div>
                          <div className="colour-swatches">
                            {OBJECT_COLORS.map((color) => (
                              <button
                                key={color}
                                type="button"
                                className={activeRegionEdit.enabled && activeRegionEdit.color === color ? "active" : ""}
                                style={{ backgroundColor: color }}
                                onClick={() => updateRegionEdit(activeRegion.id, { color, enabled: true })}
                                aria-label={`Change ${activeRegion.label} to ${color}`}
                              />
                            ))}
                            <label className="custom-colour" title={`Custom colour for ${activeRegion.label}`}>
                              <input
                                type="color"
                                value={activeRegionEdit.color}
                                onChange={(event) => updateRegionEdit(activeRegion.id, { color: event.target.value, enabled: true })}
                              />
                              <span>+</span>
                            </label>
                          </div>
                          <EditorSlider
                            icon={<Palette size={14} />}
                            label="Colour strength"
                            value={activeRegionEdit.amount}
                            min={10}
                            max={85}
                            display={`${activeRegionEdit.amount}%`}
                            onChange={(amount) => updateRegionEdit(activeRegion.id, { amount, enabled: true })}
                          />
                        </div>
                      )}
                      <p>{sceneAnalysis.regions.length} editable regions found automatically. Pick a detected item above—never paint a mask by hand.</p>
                    </>
                  ) : (
                    <div className="ai-map-state"><span>No editable room elements were confidently detected.</span></div>
                  )}
                </div>
              </aside>
            </div>

            <div className="result-footer">
              <div className="diagnostics">
                <div><span>Engine</span><strong>{humanizeEngine(result.engine)}</strong></div>
                <div><span>Source</span><strong>{result.raw_input ? "Camera RAW" : "Standard image"}</strong></div>
                <div><span>Frames</span><strong>{result.input_frames ?? files.length}</strong></div>
                <div><span>Strength</span><strong>{Math.round((result.strength ?? strength) * 100)}%</strong></div>
              </div>
              <div className="result-actions">
                <button className="secondary-button" type="button" onClick={clearAll}>
                  <RefreshCw size={17} /> New image
                </button>
                <button className="download-button" type="button" onClick={() => void downloadResult()} disabled={downloading}>
                  {downloading ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
                  {downloading ? "Rendering full quality…" : "Download with edits"}
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
