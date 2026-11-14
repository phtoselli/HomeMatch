import { useState } from "react";
import { Icon } from "../icons";

/** Foto do anúncio; se o site não entregar a imagem (alguns parceiros dão 404), mostra a casinha. */
export function Photo({ src, className, label }: { src?: string; className: string; label?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`${className} noimg`}>
        <Icon name="home" size={26} stroke={1.6} />
        {label && <span>{label}</span>}
      </div>
    );
  }
  return <img className={className} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
