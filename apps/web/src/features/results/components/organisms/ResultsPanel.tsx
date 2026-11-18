import { useEffect, useRef, useState } from "react";
import type { BBox, FeatureDef, Region, RegionLevel } from "@homematch/contracts";
import {
  atLeast,
  levelLabel,
  meters,
  money,
  noTransitNear,
  priceOf,
  slackToReach,
  tierOf,
  withBudget,
  type Filters,
  type Ranked,
} from "@homematch/domain";
import { t } from "@homematch/i18n";
import { ErrorAlert, FEATURE_ICON, Icon, Photo, Segmented, Spinner } from "@/shared/ui";
import type { Search } from "@/features/search";
import { LEVEL_COLOR, sourceName } from "@/shared/lib/format";
import { breakdown, overBudget, specsLine } from "../../lib/listing-text";
import { MatchBadge } from "../atoms/MatchBadge";
import { AmenityChips } from "../molecules/AmenityChips";
import { CommuteChip } from "../molecules/CommuteChip";
import { SortPicker } from "../molecules/SortPicker";

interface Props {
  search: Search;
  filters: Filters;
  setFilters: (f: Filters) => void;
  features: FeatureDef[];
  /** Listings already filtered and sorted (all regions). */
  ranked: Ranked[];
  regionTab: string;
  setRegionTab: (r: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onFit: (b: BBox) => void;
  onEdit: (step: number) => void;
  canRun: boolean;
  onRunAll: () => void;
  onRunListings: (regions: Region[]) => void;
  stale: boolean;
  /** Replaces the filters and searches listings again in the same regions. */
  onApplyFilters: (f: Filters) => void;
  /** Every listing of the search or only the favorites. */
  listMode: "all" | "fav";
  setListMode: (m: "all" | "fav") => void;
  /** Favorites (kept in the browser), already scored and with what does not match. */
  favorites: Ranked[];
  isFav: (id: string) => boolean;
  onToggleFav: (l: Ranked["l"]) => void;
}

const msg = t.ui.results;

/** Narrow screen: no preview over the map, tapping a card opens the detail. */
const narrow = () => window.matchMedia("(max-width: 900px)").matches;

const MIN_LEVELS: [RegionLevel, string][] = [
  ["ok", t.ui.levels.all],
  ["good", t.ui.levels.goodOrBetter],
  ["excellent", t.ui.levels.excellentOnly],
];

const TIERS = msg.tiers.map((tier, index) => ({ index, ...tier }));

/** Listing cards split by how well they match, the region list and the search warnings. */
export function ResultsPanel(p: Props) {
  const { search: s, filters: f } = p;
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const [showOthers, setShowOthers] = useState(false);

  // Pin clicked on the map: scroll the list to its card.
  useEffect(() => {
    if (p.selectedId) cardRefs.current.get(p.selectedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [p.selectedId]);

  const searched = s.searchedRegions;
  // Only regions with listings become a tab (a widened search can have up to 15).
  const tabs = [{ id: "all", label: msg.all, count: p.ranked.length, min: null as number | null }].concat(
    searched
      .map((r) => ({
        id: r.name,
        label: r.name,
        count: p.ranked.filter((x) => x.l.region === r.name).length,
        min: r.commuteMin,
      }))
      .filter((tab) => tab.count > 0 || tab.id === p.regionTab)
      .sort((a, b) => b.count - a.count),
  );
  const shown = p.regionTab === "all" ? p.ranked : p.ranked.filter((x) => x.l.region === p.regionTab);
  const byTier = TIERS.map(({ index }) => shown.filter((x) => tierOf(x.misses) === index));
  const [ideal, good, almost, others] = byTier.map((l) => l.length) as [number, number, number, number];
  // With nothing better, the other options open by default (they are all there is).
  const othersOpen = showOthers || ideal + good + almost === 0;
  const lastMessage = s.log[s.log.length - 1];
  const warnings = s.warnings;
  const a = s.analysis;
  const selectedRegions = a?.regions.filter((r) => s.selectedRegions.has(r.id)) ?? [];
  // Regions of the chosen level (or better).
  const shownRegions = a?.regions.filter((r) => atLeast(r.level, s.minLevel)) ?? [];

  function renderCard({ l, cell, match, misses }: Ranked) {
    const over = overBudget(l, f);
    const price = priceOf(l, f.basis);
    const fav = p.isFav(l.id);
    const favLabel = fav ? t.ui.listing.unfavorite : t.ui.listing.favorite;
    return (
      <div key={l.id} className="lcard-wrap">
        <button
          ref={(el) => {
            if (el) cardRefs.current.set(l.id, el);
            else cardRefs.current.delete(l.id);
          }}
          type="button"
          className="lcard"
          aria-pressed={p.selectedId === l.id}
          onClick={() => (p.selectedId === l.id || narrow() ? p.onOpen(l.id) : p.onSelect(l.id))}
          onDoubleClick={() => p.onOpen(l.id)}
        >
          <Photo className="lcard-photo" src={l.image} />
          <span className="lcard-body">
            <span className="lcard-top">
              <span className="price">
                {price ? money(price) : t.ui.listing.noPrice}
                <small>{t.ui.listing.perMonth}</small>
              </span>
              <MatchBadge value={match} />
            </span>
            <span className="lcard-sub">
              {breakdown(l)}
              {over != null && !misses.some((m) => m.kind === "price") && (
                <b className="over">{msg.overTarget(money(over))}</b>
              )}
            </span>
            <span className="lcard-title">{specsLine(l)}</span>
            <span className="lcard-sub">
              {l.region ?? l.neighbourhood ?? l.address} ·{" "}
              <span className="src-inline">
                {sourceName(l, "")}
                {l.agency && l.agency !== sourceName(l) ? ` · ${l.agency}` : ""}
              </span>
            </span>
            {misses.length > 0 && (
              <span className="lcard-chips" aria-label={msg.missesLabel}>
                {misses.map((m) => (
                  <span key={m.kind + m.label} className="chip-mini miss">
                    <Icon name="alert" size={12} /> {m.label}
                  </span>
                ))}
              </span>
            )}
            <span className="lcard-chips">
              <CommuteChip cell={cell} />
              <AmenityChips l={l} f={f} />
            </span>
          </span>
        </button>
        <button
          type="button"
          className="fav-btn"
          aria-pressed={fav}
          aria-label={favLabel}
          title={favLabel}
          onClick={() => p.onToggleFav(l)}
        >
          <Icon name="heart" size={18} />
        </button>
      </div>
    );
  }

  const switcher = (a || p.favorites.length > 0) && (
    <Segmented
      className="list-mode"
      label={msg.show}
      value={p.listMode}
      onChange={p.setListMode}
      options={[
        {
          value: "all",
          label: (
            <>
              {msg.allListings}
              {a ? <span className="seg-count">{p.ranked.length}</span> : null}
            </>
          ),
        },
        {
          value: "fav",
          label: (
            <>
              <Icon name="heart" size={14} /> {msg.favorites}
              <span className="seg-count">{p.favorites.length}</span>
            </>
          ),
        },
      ]}
    />
  );

  if (p.listMode === "fav") {
    return (
      <div className="results">
        <div className="results-head">
          {switcher}
          <div>
            <h1 className="title">{msg.yourFavorites}</h1>
            <p className="sub">{p.favorites.length ? msg.favoritesSaved(p.favorites.length) : msg.favoritesHint}</p>
          </div>
          {p.favorites.length > 1 && (
            <div className="row between">
              <span className="hint">{msg.sortBy}</span>
              <SortPicker value={f.sort} onChange={(sort) => p.setFilters({ ...f, sort })} />
            </div>
          )}
        </div>
        <div className="results-body">
          {p.favorites.length ? (
            <div className="cards">{p.favorites.map(renderCard)}</div>
          ) : (
            <div className="fav-empty">
              <span className="fav-empty-icon">
                <Icon name="heart" size={28} />
              </span>
              <b>{msg.noFavorites}</b>
              <span>{msg.noFavoritesHint}</span>
              <button type="button" className="btn primary" onClick={() => p.setListMode("all")}>
                {msg.seeAll}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const heading =
    s.busy === "analyze"
      ? msg.findingRegions
      : a?.regions.length === 0
        ? msg.noRegion
        : p.ranked.length === 0
          ? s.busy
            ? msg.searching
            : msg.noListingsYet
          : ideal
            ? msg.idealCount(ideal)
            : good
              ? msg.goodCount(good)
              : almost
                ? msg.almostCount(almost)
                : msg.othersCount(others);

  const d = s.diagnosis;
  const what = f.types.length === 1 && f.types[0] === "apartment" ? msg.apartment : msg.property;

  return (
    <div className="results">
      <div className="results-head">
        {switcher}
        {s.busy && (
          <div className="progress" role="status">
            <Spinner />
            <div>
              <b>{s.busy === "analyze" ? msg.analyzing : msg.searching}</b>
              {lastMessage && <span>{lastMessage}</span>}
              {s.busy === "analyze" && <span className="muted">{msg.firstAnalysis}</span>}
            </div>
          </div>
        )}
        {s.error && <ErrorAlert>{s.error}</ErrorAlert>}

        {!a && !s.busy && (
          <div className="empty">
            <h1 className="title">{msg.welcome}</h1>
            <p className="sub">{msg.welcomeHint}</p>
            {p.canRun ? (
              <button type="button" className="btn primary big" onClick={p.onRunAll}>
                {msg.showListings} <Icon name="chevR" />
              </button>
            ) : (
              <button type="button" className="btn primary big" onClick={() => p.onEdit(0)}>
                {msg.setUpSearch} <Icon name="chevR" />
              </button>
            )}
          </div>
        )}

        {a && (
          <>
            <div>
              <h1 className="title">{heading}</h1>
              {a.regions.length > 0 && p.ranked.length > 0 && (
                <p className="sub">
                  {[ideal && good ? msg.plusGood(good) : "", (ideal || good) && almost ? msg.plusAlmost(almost) : ""]
                    .filter(Boolean)
                    .map((text) => (
                      <b key={text}>{text} · </b>
                    ))}
                  {msg.inRegions(searched.length || selectedRegions.length)}
                </p>
              )}
            </div>

            {a.regions.length === 0 && !s.busy && (
              <div className="alert">
                <span>{msg.noRegionHint}</span>
                <div className="row">
                  <button type="button" className="btn primary" onClick={() => p.onEdit(1)}>
                    {msg.changePriorities}
                  </button>
                  <button type="button" className="btn" onClick={() => p.onEdit(2)}>
                    {msg.reviewDistances}
                  </button>
                </div>
              </div>
            )}

            {p.stale && !s.busy && (
              <button type="button" className="alert action" onClick={() => p.onRunListings(selectedRegions)}>
                <Icon name="refresh" /> {msg.filtersChanged} <b>{msg.searchAgain}</b>
              </button>
            )}

            {searched.length > 1 && (
              <div className="pills" role="group" aria-label={msg.region}>
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className="pill"
                    aria-pressed={p.regionTab === tab.id}
                    onClick={() => p.setRegionTab(tab.id)}
                  >
                    {tab.label}
                    {tab.min != null && <span className="pill-meta">~{tab.min} min</span>}
                    <span className="pill-count">{tab.count}</span>
                  </button>
                ))}
              </div>
            )}

            {p.ranked.length > 0 && (
              <div className="row between">
                <span className="hint">{msg.sortBy}</span>
                <SortPicker value={f.sort} onChange={(sort) => p.setFilters({ ...f, sort })} />
              </div>
            )}
          </>
        )}
      </div>

      <div className="results-body">
        {a && a.regions.length > 0 && !s.busy && s.listings.length > 0 && shown.length === 0 && (
          <div className="alert">
            <span>
              {p.ranked.length === 0 && f.hideUnknown
                ? msg.hiddenUnknown(s.listings.length, (f.amenities ?? []).length > 1)
                : msg.noneWithFilters(p.regionTab === "all" ? undefined : p.regionTab)}
            </span>
            <div className="row">
              {f.hideUnknown && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => p.setFilters({ ...f, hideUnknown: false })}
                >
                  {msg.showUnknown}
                </button>
              )}
              <button type="button" className="btn" onClick={() => p.onEdit(3)}>
                {msg.changeFilters}
              </button>
            </div>
          </div>
        )}
        {a && a.regions.length > 0 && !s.busy && !s.sources.length && (
          <div className="alert">
            {msg.noSites}
            <div className="row">
              <button type="button" className="btn primary" onClick={() => p.onEdit(3)}>
                {msg.chooseSites}
              </button>
            </div>
          </div>
        )}
        {a &&
          a.regions.length > 0 &&
          !s.busy &&
          s.searchedWith !== null &&
          s.listings.length === 0 &&
          s.sources.length > 0 && (
            <div className="alert diag">
              <b>{msg.noneInRegions}</b>
              {d ? (
                <>
                  <span>
                    {d.cheapestSame != null
                      ? msg.cheapest(
                          what,
                          f.minBedrooms,
                          money(d.cheapestSame),
                          d.ceiling ? money(d.ceiling) : undefined,
                        ) +
                        (d.sameCount > 1 ? msg.sameCount(d.sameCount, money(Math.round((d.ceiling ?? 0) * 1.6))) : "") +
                        "."
                      : d.ceiling
                        ? msg.noneUpTo(f.minBedrooms, money(Math.round(d.ceiling * 1.6)))
                        : msg.noneOfType}
                    {d.others > 0 && msg.othersWithin(d.others, money(d.othersCheapest!))}
                  </span>
                  <div className="row">
                    {d.cheapestSame != null && f.budget && (
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() =>
                          p.onApplyFilters(withBudget(f, f.budget!, slackToReach(f.budget!, d.cheapestSame!)))
                        }
                      >
                        {msg.acceptUpTo(money(d.cheapestSame))}
                      </button>
                    )}
                    {d.others > 0 && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => p.onApplyFilters({ ...f, types: [], minBedrooms: 0 })}
                      >
                        {msg.seeOthers(d.others)}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <span>{msg.raiseBudget}</span>
              )}
            </div>
          )}

        {TIERS.map(({ index, title, hint }) => {
          const list = byTier[index]!;
          if (!list.length) return null;
          const collapsed = index === 3 && !othersOpen;
          return (
            <section key={index} className={`tier tier${index}`} aria-label={title}>
              <div className="tier-head">
                <h2 className="h3">
                  {title} <span className="tier-count">{list.length}</span>
                </h2>
                {collapsed ? (
                  <button type="button" className="linkbtn" onClick={() => setShowOthers(true)}>
                    {msg.show}
                  </button>
                ) : (
                  <span className="hint">{hint}</span>
                )}
              </div>
              {!collapsed && <div className="cards">{list.slice(0, 120).map(renderCard)}</div>}
              {!collapsed && list.length > 120 && <p className="hint center">{msg.first120}</p>}
            </section>
          );
        })}

        {a && a.regions.length > 0 && (
          <details className="regions-box">
            <summary>
              <span>{msg.regionsFound}</span>
              <span className="muted">{msg.regionsSummary(shownRegions.length, selectedRegions.length)}</span>
            </summary>
            <div className="seg small" role="group" aria-label={t.ui.levels.whichRegions}>
              {MIN_LEVELS.map(([level, label]) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={s.minLevel === level}
                  onClick={() => s.setMinLevel(level)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="hint">
              {msg.regionsHint(
                a.stats.levels.excellent,
                a.stats.levels.good,
                a.stats.levels.ok,
                a.stats.commuteBestMin,
                a.stats.commuteRefMin,
              )}
            </p>
            <ol className="regions">
              {shownRegions.slice(0, 30).map((r) => (
                <li key={r.id} data-on={s.selectedRegions.has(r.id) || undefined}>
                  <input
                    type="checkbox"
                    aria-label={msg.includeRegion(r.name)}
                    checked={s.selectedRegions.has(r.id)}
                    onChange={() => {
                      const next = new Set(s.selectedRegions);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      s.setSelectedRegions(next);
                    }}
                  />
                  <button type="button" className="region-btn" onClick={() => p.onFit(r.bbox)}>
                    <span className="rname">
                      {r.rank}. {r.name}
                      <span className="rtag level" style={{ background: LEVEL_COLOR[r.level] }}>
                        {levelLabel(r.level)}
                      </span>
                    </span>
                    <span className="rmeta">
                      <Icon name="bus" size={12} />{" "}
                      {noTransitNear(r) ? msg.noBusNearby : `${r.commuteMin}–${r.commuteAvg} min`}
                      {Object.entries(r.featureDist).map(([k, dist]) => (
                        <span key={k} className="rfeat" title={p.features.find((x) => x.id === k)?.label}>
                          <Icon name={FEATURE_ICON[k] ?? "pin"} size={12} /> {meters(dist)}
                        </span>
                      ))}
                    </span>
                  </button>
                  <span className="score" title={msg.regionScore}>
                    {r.score.toFixed(0)}
                  </span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className={`btn ${p.stale ? "primary" : ""}`}
              disabled={s.busy !== null || !selectedRegions.length || !s.sources.length}
              onClick={() => p.onRunListings(selectedRegions)}
            >
              <Icon name="refresh" /> {msg.searchIn(selectedRegions.length)}
            </button>
          </details>
        )}

        {warnings.length > 0 && (
          <details className="warnings">
            <summary>{msg.warnings(warnings.length)}</summary>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
