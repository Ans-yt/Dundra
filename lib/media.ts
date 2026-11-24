import { RequestError } from "./http";

const imageLimit = 5 * 1024 * 1024;
export type StoredImage = { bytes: Uint8Array; mime: string };

export function readImage(value: unknown): StoredImage | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || value.length > Math.ceil(imageLimit / 3) * 4 + 40) {
    throw new RequestError("Choose an image smaller than 5 MB.", 413);
  }
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new RequestError("Choose a PNG, JPEG, WebP, or GIF image.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > imageLimit) throw new RequestError("Choose an image smaller than 5 MB.", 413);
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
    : bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
    : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp"
    : ["GIF89a", "GIF87a"].includes(bytes.toString("ascii", 0, 6)) ? "image/gif" : "";
  if (mime !== match[1]) throw new RequestError("The image contents don't match its format.");
  return { bytes, mime };
}
