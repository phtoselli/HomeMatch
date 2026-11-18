import { t } from "@homematch/i18n";

/** "87% match", colored by how good the match is. */
export function MatchBadge({ value }: { value: number }) {
  const tone = value >= 80 ? "hi" : value >= 65 ? "mid" : "lo";
  return (
    <span className={`match ${tone}`} title={t.ui.listing.matchHint}>
      {t.ui.listing.match(value)}
    </span>
  );
}
