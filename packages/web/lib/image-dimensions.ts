/**
 * Extract image dimensions from a Buffer by reading file headers.
 * Supports JPEG, PNG, GIF, and WebP — no external dependencies. (TASK-0025)
 *
 * Returns { width, height } or null if not a recognized image format.
 */
export function getImageDimensions(
  buffer: Buffer,
  mimeType: string,
): { width: number; height: number } | null {
  try {
    switch (mimeType) {
      case "image/png":
        return getPngDimensions(buffer);
      case "image/jpeg":
        return getJpegDimensions(buffer);
      case "image/gif":
        return getGifDimensions(buffer);
      case "image/webp":
        return getWebpDimensions(buffer);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * PNG: IHDR chunk starts at byte 16, width at 16-19, height at 20-23 (big-endian)
 * Signature: 89 50 4E 47 0D 0A 1A 0A
 */
function getPngDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  // Verify PNG signature
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

/**
 * JPEG: Scan for SOF0 (0xFF 0xC0) or SOF2 (0xFF 0xC2) marker.
 * Height at marker+5, width at marker+7 (big-endian uint16).
 */
function getJpegDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 4) return null;
  // Verify JPEG SOI marker
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1];

    // SOF markers (SOF0-SOF3, SOF5-SOF7, SOF9-SOF11, SOF13-SOF15)
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 9 > buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }

    // Skip non-SOF markers
    if (offset + 3 >= buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }

  return null;
}

/**
 * GIF: Width at bytes 6-7, height at bytes 8-9 (little-endian)
 * Signature: GIF87a or GIF89a
 */
function getGifDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 10) return null;
  const sig = buffer.toString("ascii", 0, 3);
  if (sig !== "GIF") return null;
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  return { width, height };
}

/**
 * WebP: RIFF container. Dimensions depend on VP8/VP8L/VP8X sub-format.
 * Signature: RIFF....WEBP
 */
function getWebpDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 30) return null;
  const riff = buffer.toString("ascii", 0, 4);
  const webp = buffer.toString("ascii", 8, 12);
  if (riff !== "RIFF" || webp !== "WEBP") return null;

  const chunk = buffer.toString("ascii", 12, 16);

  if (chunk === "VP8 ") {
    // Lossy VP8: frame tag at offset 26, width at 26, height at 28
    if (buffer.length < 30) return null;
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }

  if (chunk === "VP8L") {
    // Lossless VP8L: signature byte at 21, then 32-bit packed dimensions
    if (buffer.length < 25) return null;
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }

  if (chunk === "VP8X") {
    // Extended VP8X: width at 24 (3 bytes LE + 1), height at 27 (3 bytes LE + 1)
    if (buffer.length < 30) return null;
    const width = (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1;
    const height = (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1;
    return { width, height };
  }

  return null;
}
