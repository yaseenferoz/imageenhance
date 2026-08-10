export const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

export type EnhanceResponse = {
  status: "success" | "error";
  enhanced_image_url: string;
  original_preview_url?: string | null;
  message?: string;
  detail?: string;
  strength?: number;
  median_luminance?: number;
  dark_fraction?: number;
  colour_cast_ratio?: number;
  mean_saturation?: number;
  relighting_amount?: number;
  applied?: boolean;
  engine?: string;
  input_frames?: number;
  frame_fusion?: string;
  raw_input?: boolean;
  raw_processing?: string;
  fused_frames?: number;
  room_groups?: number;
  grouping_model?: string;
  results?: RoomResult[];
};

export type RoomResult = {
  room_id: string;
  label: string;
  filename: string;
  image: string;
  enhanced_image_url: string;
  original_preview_url: string;
  input_frames: number;
  fused_frames: number;
  frame_fusion?: string;
  engine?: string;
  applied?: boolean;
  raw_input?: boolean;
  raw_processing?: string;
  median_luminance?: number;
  dark_fraction?: number;
  colour_cast_ratio?: number;
  mean_saturation?: number;
  relighting_amount?: number;
  room_confidence: number;
  source_indices: number[];
  source_filenames: string[];
  master_filename: string;
  selection_strategy: "best-master-view" | "canonical-view-best-regions";
};

type PreviewResponse = {
  status: "success" | "error";
  preview_url?: string;
  message?: string;
  detail?: string;
};

type EnhancementJobStart = {
  status: "queued";
  job_id: string;
};

type EnhancementJobStatus = {
  status: "queued" | "processing" | "completed" | "failed";
  job_id: string;
  stage?: string;
  detail?: string;
  result?: EnhanceResponse;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & {
    detail?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(
      payload.detail || payload.message || `Request failed (${response.status})`,
    );
  }

  return payload;
}

export async function checkBackend(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function createRawPreview(file: File): Promise<string> {
  const data = new FormData();
  data.append("file", file);

  const response = await fetch(`${API_URL}/preview`, {
    method: "POST",
    body: data,
  });
  const payload = await readJson<PreviewResponse>(response);

  if (!payload.preview_url) {
    throw new Error("The backend did not return a RAW preview.");
  }

  return payload.preview_url;
}

export async function enhanceImages(
  files: File[],
  strength: number,
  onStage?: (stage: string) => void,
): Promise<EnhanceResponse> {
  const data = new FormData();
  files.forEach((file) => data.append("files", file));
  data.append("strength", String(strength));

  const response = await fetch(`${API_URL}/enhance-jobs`, {
    method: "POST",
    body: data,
  });
  const job = await readJson<EnhancementJobStart>(response);
  onStage?.("Upload complete · queued for RAW decoding");

  for (let attempt = 0; attempt < 900; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    const statusResponse = await fetch(
      `${API_URL}/enhance-jobs/${job.job_id}?t=${Date.now()}`,
      { cache: "no-store" },
    );
    const status = await readJson<EnhancementJobStatus>(statusResponse);
    if (status.stage) onStage?.(status.stage);
    if (status.status === "completed" && status.result) return status.result;
    if (status.status === "failed") {
      throw new Error(status.detail || "Image enhancement failed.");
    }
  }

  throw new Error("Enhancement is still running after 30 minutes. Please try again.");
}
