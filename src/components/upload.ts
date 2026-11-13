'use client';

/** Shrink a photo on the phone before upload: saves data on 3G and storage on the server. */
export async function compressImage(file: File, maxSide: number, quality: number): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * scale);
    cv.height = Math.round(img.height * scale);
    cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise<Blob>((res) => cv.toBlob((b) => res(b ?? file), 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadFile(blob: Blob, purpose: 'cover' | 'document'): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const form = new FormData();
  form.append('file', blob, purpose === 'cover' ? 'cover.jpg' : 'document');
  form.append('purpose', purpose);
  try {
    const res = await fetch('/api/files', { method: 'POST', body: form, credentials: 'same-origin' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error ?? 'generic' };
    return { ok: true, id: json.id };
  } catch {
    return { ok: false, error: 'network' };
  }
}
