import { nativeImage, type NativeImage } from 'electron'

/** Wraps a PNG in a single-image .ico container (PNG-compressed entries are valid since Windows Vista). */
export function pngToIco(image: NativeImage): Buffer {
  const png = image.toPNG(), { width, height } = image.getSize()
  const header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2)  // type: icon
  header.writeUInt16LE(1, 4)  // one image
  header[6] = width >= 256 ? 0 : width
  header[7] = height >= 256 ? 0 : height
  header.writeUInt16LE(1, 10)  // planes
  header.writeUInt16LE(32, 12)  // bits per pixel
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(22, 18)  // image offset
  return Buffer.concat([header, png])
}

/** Repaints a one-color icon (the mascot) in `hex`, keeping its transparency. Returns the image unchanged if the color is invalid. */
export function tintIcon(base: NativeImage, hex: string): NativeImage {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match || base.isEmpty()) return base
  const value = parseInt(match[1]!, 16), red = (value >> 16) & 255, green = (value >> 8) & 255, blue = value & 255
  const { width, height } = base.getSize()
  // The bitmap is BGRA with premultiplied alpha, so each channel is scaled by the pixel's alpha.
  const pixels = Buffer.from(base.toBitmap())
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3]! / 255
    pixels[index] = Math.round(blue * alpha)
    pixels[index + 1] = Math.round(green * alpha)
    pixels[index + 2] = Math.round(red * alpha)
  }
  return nativeImage.createFromBitmap(pixels, { width, height })
}
