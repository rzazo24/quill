// A photo, made ready to upload in the browser: drawn again on a canvas, which leaves behind everything the camera wrote into the file (the place it
// was taken, the phone, the time), at most 2048 px on its longer side, as JPEG. What is uploaded is only the picture.
export const MAX_SIDE = 2048

export async function preparePhoto(file: Blob): Promise<{ blob: Blob; dim: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) // turned as it was shot, then the orientation tag goes too
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h) // a transparent PNG becomes white, not black
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new Error('could not encode')
  return { blob, dim: `${w}x${h}` }
}
