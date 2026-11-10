// Prepares a picked, pasted or photographed file for the AI and for storage.
// Images are shrunk on the device first: smaller uploads, faster AI, far less data moved.

const MAX_SIDE = 1600;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function shrinkImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // unsupported format for canvas: send as is
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  return blob || file;
}

// Returns { kind: 'image'|'pdf'|'text', name, mime, blob, base64?, text?, previewUrl? }
export async function prepareFile(file, source) {
  const name = file.name || (source === 'photo' ? 'photo.jpg' : 'screenshot.jpg');
  if (file.type.startsWith('image/')) {
    const blob = await shrinkImage(file);
    const mime = blob.type || 'image/jpeg';
    return {
      kind: 'image',
      source: source || 'screenshot',
      name: name.replace(/\.(png|heic|heif|webp|gif)$/i, '.jpg'),
      mime,
      blob,
      base64: await blobToBase64(blob),
      previewUrl: URL.createObjectURL(blob),
    };
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
    if (file.size > MAX_PDF_BYTES) throw new Error('PDF is larger than 10 MB.');
    return { kind: 'pdf', source: 'document', name, mime: 'application/pdf', blob: file, base64: await blobToBase64(file) };
  }
  if (file.type.startsWith('text/') || /\.(txt|md|csv)$/i.test(name)) {
    const text = (await file.text()).slice(0, 20000);
    return { kind: 'text', source: 'document', name, mime: file.type || 'text/plain', blob: file, text };
  }
  throw new Error('Supported: images, PDF and text files.');
}

export function captureFromPaste(e) {
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}
