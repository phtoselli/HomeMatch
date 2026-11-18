import type { ReactNode, RefObject } from "react";

interface Props {
  /** Top bar (search summary and mode switch). */
  header: ReactNode;
  /** Optional bar under the header (filter chips). */
  toolbar?: ReactNode;
  /** Side panel content (results or links). */
  panel: ReactNode;
  /** Small print at the bottom of the panel (data credits). */
  credits: ReactNode;
  /** The map and everything floating over it. */
  map: ReactNode;
  mapRef?: RefObject<HTMLElement>;
  /** Covers panel and map (setup wizard). */
  overlay?: ReactNode;
  /** Full-screen dialogs (listing detail, timetable). */
  dialogs?: ReactNode;
  /** While picking the work location on the map (crosshair cursor). */
  picking?: boolean;
}

/** Page skeleton: header, optional toolbar, side panel + map, overlay and dialogs. No data, only slots. */
export function MapLayout({ header, toolbar, panel, credits, map, mapRef, overlay, dialogs, picking }: Props) {
  return (
    <div className={`app ${picking ? "picking" : ""}`}>
      {header}
      {toolbar}
      <div className="main">
        <aside className="panel">
          {panel}
          <p className="credits">{credits}</p>
        </aside>
        <main className="mapwrap" ref={mapRef}>
          {map}
        </main>
        {overlay}
      </div>
      {dialogs}
    </div>
  );
}
