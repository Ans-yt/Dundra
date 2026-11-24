const mediaTypes = ["image/jpeg","image/png","image/webp","image/gif","audio/wav","audio/mpeg","video/mp4","video/webm"];
export function attachmentKinds(audio:boolean,video:boolean) {
  return mediaTypes.filter(t=>t.startsWith("image/") || (audio && t.startsWith("audio/")) || (video && t.startsWith("video/")));
}
export function mediaParts(content: string, data: string | string[], quality: 'auto' | 'low' | 'high' = 'auto') {
  const files = (typeof data === "string" ? [data] : data).map(url => {
    const separator = url.indexOf(",");
    const mime = url.slice(5, separator - 7);
    if (mime.startsWith("image/")) return { type: "image_url", image_url: { url, ...(quality !== "auto" && { detail: quality }) } };
    if (mime.startsWith("video/")) return { type: "video_url", video_url: { url } };
    return { type: "input_audio", input_audio: { data: url.slice(separator + 1), format: mime === "audio/wav" ? "wav" : "mp3" } };
  });
  return [...(content ? [{ type: "text", text: content }] : []), ...files];
}
