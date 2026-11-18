import { useState } from "react";
import { safeExternalUrl } from "@homematch/domain";
import { Icon } from "./Icon";

/** Listing photo; if the site does not deliver the image (some partners return 404), shows a house icon. */
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
