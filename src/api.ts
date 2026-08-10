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
};

export type SceneRegion = {
  id: number;
  label: string;
  source_label: string;
  kind: "surface" | "object";
  area_fraction: number;
  current_color: string;
};

export type SceneAnalysisResponse = {
  status: "success" | "error";
  mask_url: string;
  regions: SceneRegion[];
  model: string;
  device: string;
  detected_regions: number;
  image_width: number;
  image_height: number;
};

type PreviewResponse = {
  status: "success" | "error";
  preview_url?: string;
  message?: string;
  detail?: string;
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
): Promise<EnhanceResponse> {
  const data = new FormData();
  files.forEach((file) => data.append("files", file));
  data.append("strength", String(strength));

  const response = await fetch(`${API_URL}/enhance`, {
    method: "POST",
    body: data,
  });
  return readJson<EnhanceResponse>(response);
}

export async function analyzeScene(imageUrl: string): Promise<SceneAnalysisResponse> {
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error("Could not prepare the enhanced image for AI scene detection.");
  const imageBlob = await imageResponse.blob();
  const data = new FormData();
  data.append("file", new File([imageBlob], "enhanced-scene.jpg", { type: imageBlob.type || "image/jpeg" }));

  const response = await fetch(`${API_URL}/analyze-scene`, {
    method: "POST",
    body: data,
  });
  return readJson<SceneAnalysisResponse>(response);
}
