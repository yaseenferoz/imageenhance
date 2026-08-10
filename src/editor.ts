export type EditorSettings = {
  exposure: number;
  contrast: number;
  saturation: number;
  warmth: number;
};

export type RegionEdit = {
  color: string;
  amount: number;
  enabled: boolean;
};

export type RegionEdits = Record<number, RegionEdit>;

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
};

function clamp(value: number) {
  return Math.max(0, Math.min(255, value));
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

async function loadBitmap(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load the image editor.");
  return createImageBitmap(await response.blob());
}

export async function loadImageData(url: string, maxEdge?: number) {
  const bitmap = await loadBitmap(url);
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height)) : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas editing is unavailable in this browser.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return context.getImageData(0, 0, width, height);
}

export async function loadSegmentMap(url: string, width: number, height: number) {
  const bitmap = await loadBitmap(url);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas segmentation is unavailable in this browser.");
  context.imageSmoothingEnabled = false;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  const segments = new Uint8Array(width * height);
  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
    segments[pixel] = pixels[index];
  }
  return segments;
}

export function applyEditorSettings(
  source: ImageData,
  settings: EditorSettings,
  segmentMap?: Uint8Array | null,
  regionEdits: RegionEdits = {},
) {
  const output = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const pixels = output.data;
  const exposure = 2 ** settings.exposure;
  const contrast = 1 + settings.contrast / 100;
  const saturation = 1 + settings.saturation / 100;
  const warmth = settings.warmth / 100;
  const preparedEdits = new Map(
    Object.entries(regionEdits)
      .filter(([, edit]) => edit.enabled)
      .map(([id, edit]) => {
        const color = hexToRgb(edit.color);
        return [Number(id), { ...edit, ...color, luma: Math.max(1, color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722) }];
      }),
  );

  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
    let red = pixels[index];
    let green = pixels[index + 1];
    let blue = pixels[index + 2];
    const edit = segmentMap ? preparedEdits.get(segmentMap[pixel]) : undefined;

    if (edit) {
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const tintScale = Math.max(0.22, Math.min(2.8, luminance / edit.luma));
      const blend = edit.amount / 100;
      red = red * (1 - blend) + clamp(edit.r * tintScale) * blend;
      green = green * (1 - blend) + clamp(edit.g * tintScale) * blend;
      blue = blue * (1 - blend) + clamp(edit.b * tintScale) * blend;
    }

    red *= exposure;
    green *= exposure;
    blue *= exposure;
    red = (red - 127.5) * contrast + 127.5;
    green = (green - 127.5) * contrast + 127.5;
    blue = (blue - 127.5) * contrast + 127.5;
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    red = luminance + (red - luminance) * saturation + warmth * 15;
    green = luminance + (green - luminance) * saturation + warmth * 3;
    blue = luminance + (blue - luminance) * saturation - warmth * 15;
    pixels[index] = clamp(red);
    pixels[index + 1] = clamp(green);
    pixels[index + 2] = clamp(blue);
  }

  return output;
}

export function paintEditorCanvas(
  canvas: HTMLCanvasElement,
  source: ImageData,
  settings: EditorSettings,
  segmentMap?: Uint8Array | null,
  regionEdits: RegionEdits = {},
) {
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d");
  context?.putImageData(applyEditorSettings(source, settings, segmentMap, regionEdits), 0, 0);
}

export async function exportEditedImage(
  imageUrl: string,
  settings: EditorSettings,
  maskUrl: string | null,
  regionEdits: RegionEdits,
) {
  const source = await loadImageData(imageUrl);
  const segmentMap = maskUrl
    ? await loadSegmentMap(maskUrl, source.width, source.height)
    : null;
  const canvas = document.createElement("canvas");
  paintEditorCanvas(canvas, source, settings, segmentMap, regionEdits);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not export the edited image."))),
      "image/jpeg",
      0.96,
    );
  });
}
