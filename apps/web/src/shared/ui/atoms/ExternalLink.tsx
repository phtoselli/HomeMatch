import type { AnchorHTMLAttributes, ReactNode } from "react";
import { safeExternalUrl } from "@homematch/domain";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel"> & {
  href: string | null | undefined;
  children: ReactNode;
};

/**
 * Link leaving the app (listing, agency or operator website). Opens in a new tab and only accepts http(s): these
 * addresses come from third-party sites and OpenStreetMap, and a `javascript:` URL would run code here.
 * Without a valid address, it renders nothing.
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
