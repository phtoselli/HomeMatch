import type { LinkResult, LinksRequest, StreamEvent } from "@homematch/contracts";
import { resolveLink } from "@homematch/sources";
import { t } from "@homematch/i18n";

/** Reads pasted links one by one; a broken link becomes an error on that item and the list goes on. */
export async function resolveLinks(
  req: LinksRequest,
  emit: (ev: StreamEvent<LinkResult[]>) => void,
): Promise<LinkResult[]> {
  const results: LinkResult[] = [];
  for (const [i, url] of req.urls.entries()) {
    emit({ type: "progress", message: t.links.reading(i + 1, req.urls.length) });
    let r: LinkResult;
    try {
      r = { index: i + 1, url, listing: await resolveLink(url, req.cityBBox) };
    } catch (e) {
      r = { index: i + 1, url, error: (e as Error).message };
    }
    results.push(r);
    emit({ type: "partial", data: [r] });
  }
  return results;
}
