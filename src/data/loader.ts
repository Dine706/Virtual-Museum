// fetch() with byte-level progress, and exact (no colour management) image decoding to pixels.

export type ProgressFn = (loaded: number, total: number) => void;

export async function fetchBlob(url: string, onProgress?: ProgressFn, expected = 0): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || expected;
  if (!res.body || !onProgress) return res.blob();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, Math.max(total, loaded));
  }
  onProgress(loaded, loaded);
  return new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? '' });
}

/** Decode an image to raw RGBA bytes without colour-space conversion or premultiplication
 *  (required: the Terrarium PNG encodes heights in its RGB values). */
export async function decodePixels(blob: Blob): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const { width, height } = bmp;
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (typeof OffscreenCanvas !== 'undefined') {
    ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
  } else {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    ctx = c.getContext('2d', { willReadFrequently: true });
  }
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}
