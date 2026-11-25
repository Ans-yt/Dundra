"use client";
import DOMPurify from "dompurify";
import { useEffect, useRef, useState } from "react";

export function HtmlFragment({html}:{html:string}) {
  const frame=useRef<HTMLIFrameElement>(null);
  const observer=useRef<ResizeObserver | null>(null);
  const [source,setSource]=useState("");
  useEffect(()=>{
    const safe=DOMPurify.sanitize(html,{FORCE_BODY:true,USE_PROFILES:{html:true,svg:true},FORBID_TAGS:["form","input","button","a","iframe","object","embed","base","link","meta","script"]});
    const { color: ink, colorScheme } = getComputedStyle(frame.current!);
    const scheme = colorScheme === "light" ? "light" : "dark";
    setSource(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>*{box-sizing:border-box}html,body{margin:0;background:transparent}html{color-scheme:${scheme}}body{display:flow-root;color:${ink};font:16px/1.5 system-ui;overflow-wrap:anywhere}img{max-width:100%}</style>`+safe);
    return ()=>observer.current?.disconnect();
  },[html]);
  return <iframe ref={frame} className="message-html" title="Formatted message" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={source} onLoad={()=>{
    observer.current?.disconnect();
    const el=frame.current, body=el?.contentDocument?.body;if(!el || !body)return;
    const prose = el.closest(".chat-prose");
    if (prose) {
      const type = getComputedStyle(prose);
      body.style.fontSize = type.fontSize;
      body.style.fontFamily = type.fontFamily;
    }
    const fit=()=>{el.style.height=Math.min(1600,Math.max(24,Math.ceil(body.getBoundingClientRect().height)))+"px";};
    fit(); observer.current=new ResizeObserver(fit);observer.current.observe(body);
  }}/>;
}
