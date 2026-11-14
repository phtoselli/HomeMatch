import type { LinkResult, LinksRequest, StreamEvent } from "@homematch/contracts";
import { resolveLink } from "@homematch/sources";

/** Lê os links colados um a um; um link quebrado vira erro naquele item e a lista segue. */
export async function resolveLinks(
  req: LinksRequest,
  emit: (ev: StreamEvent<LinkResult[]>) => void,
): Promise<LinkResult[]> {
  const results: LinkResult[] = [];
  for (const [i, url] of req.urls.entries()) {
    emit({ type: "progress", message: `Lendo link ${i + 1} de ${req.urls.length}…` });
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
