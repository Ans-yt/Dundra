const mediaTypes = ["image/jpeg","image/png","image/webp","image/gif","audio/wav","audio/mpeg","video/mp4","video/webm"];
export function attachmentKinds(audio:boolean,video:boolean) {
  return mediaTypes.filter(t=>t.startsWith("image/") || (audio && t.startsWith("audio/")) || (video && t.startsWith("video/")));
}
export function mediaParts(content:string, data:string, quality: 'auto' | 'low' | 'high' = 'auto') {
  const [header,bytes]=data.split(",");
  const mime=header.slice(5,-7);
  const file=mime.startsWith("image/") ? { type:"image_url",image_url:{url:data, ...(quality !== 'auto' && { detail: quality })} } : mime.startsWith("video/") ?
    {type:"video_url",video_url:{url:data}} : {type:"input_audio",input_audio:{data:bytes,format:mime==="audio/wav"?"wav":"mp3"}};
  return [...(content?[{type:"text",text:content}]:[]),file];
}
