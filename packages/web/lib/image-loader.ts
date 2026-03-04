import type { ImageLoaderProps } from "next/image";

// Allow dynamic user-provided image URLs without hardcoding host allowlists.
export function passthroughImageLoader({ src }: ImageLoaderProps) {
  return src;
}
