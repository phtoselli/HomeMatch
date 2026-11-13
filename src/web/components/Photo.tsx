import { useState } from "react";

/** Foto do anúncio; se o site não entregar a imagem (alguns parceiros dão 404), mostra a casinha. */
export function Photo({ src, className }: { src?: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className={`${className} noimg`}>🏠</div>;
  return <img className={className} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
