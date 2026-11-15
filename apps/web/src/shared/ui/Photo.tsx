import { useState } from "react";
import { safeExternalUrl } from "@homematch/domain";
import { Icon } from "./Icon";

/** Foto do anúncio; se o site não entregar a imagem (alguns parceiros dão 404), mostra a casinha. */
export function Photo({ src, className, label }: { src?: string; className: string; label?: string }) {
  const [failed, setFailed] = useState(false);
  const url = safeExternalUrl(src);
  if (!url || failed) {
    return (
      <div className={`${className} noimg`}>
        <Icon name="home" size={26} stroke={1.6} />
        {label && <span>{label}</span>}
      </div>
    );
  }
  return (
    <img
      className={className}
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
