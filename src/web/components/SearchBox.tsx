import { useEffect, useRef, useState } from "react";
import type { PlaceResult } from "../../shared/types";

interface Props {
  placeholder: string;
  search: (q: string) => Promise<PlaceResult[]>;
  onSelect: (p: PlaceResult) => void;
  initial?: string;
  minChars?: number;
}

/** Campo com sugestões (debounce de 450 ms — o Nominatim aceita 1 req/s). */
export function SearchBox({ placeholder, search, onSelect, initial = "", minChars = 3 }: Props) {
  const [q, setQ] = useState(initial);
  const [items, setItems] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Só busca quando a pessoa digitou (não ao carregar o valor salvo nem ao escolher uma sugestão).
  const typed = useRef(false);

  useEffect(() => setQ(initial), [initial]);

  useEffect(() => {
    if (!typed.current) return;
    if (q.trim().length < minChars) {
      setItems([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      setErr(null);
      try {
        setItems(await search(q.trim()));
        setOpen(true);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="searchbox">
      <input
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          typed.current = true;
          setQ(e.target.value);
        }}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {loading && <span className="spinner small" />}
      {open && items.length > 0 && (
        <ul className="suggestions">
          {items.map((it) => (
            <li
              key={it.osmId}
              onMouseDown={() => {
                typed.current = false;
                setQ(it.name);
                setOpen(false);
                onSelect(it);
              }}
            >
              <b>{it.name}</b>
              <small>{it.displayName}</small>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && typed.current && q.length >= minChars && items.length === 0 && <div className="hint">Nada encontrado.</div>}
      {err && <div className="error">{err}</div>}
    </div>
  );
}
