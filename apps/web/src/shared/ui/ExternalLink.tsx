import type { AnchorHTMLAttributes, ReactNode } from "react";
import { safeExternalUrl } from "@homematch/domain";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel"> & {
  href: string | null | undefined;
  children: ReactNode;
};

/**
 * Link para fora do app (anúncio, site da imobiliária, do operador). Abre em outra aba e só aceita http(s):
 * esses endereços vêm de sites de terceiros e do OpenStreetMap, e um `javascript:` rodaria código aqui.
 * Sem endereço válido, não mostra nada.
 */
export function ExternalLink({ href, children, ...rest }: Props) {
  const url = safeExternalUrl(href);
  if (!url) return null;
  return (
    <a {...rest} href={url} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
