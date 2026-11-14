import { useEffect, useRef, useState } from "react";
import type { PlaceResult } from "@homematch/contracts";
import { Icon, Spinner } from "../../shared/ui";

interface Props {
  placeholder: string;
  search: (q: string) => Promise<PlaceResult[]>;
  onSelect: (p: PlaceResult) => void;
  initial?: string;
  minChars?: number;
}

/**
 * Campo de busca de lugar. Busca só ao apertar Enter ou o botão: a política do Nominatim
 * não permite autocompletar a cada tecla (e cada busca de endereço pode virar várias consultas).
 * Com um único resultado, já escolhe; com vários, mostra a lista.
 */
export function SearchBox({ placeholder, search, onSelect, initial = "", minChars = 3 }: Props) {
  const [q, setQ] = useState(initial);
  const [items, setItems] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  // Só a resposta da última busca vale (uma lenta não sobrescreve a mais nova).
  const seq = useRef(0);

  useEffect(() => setQ(initial), [initial]);

  function choose(it: PlaceResult) {
    setQ(it.name);
    setOpen(false);
    setItems([]);
    onSelect(it);
  }

  async function run() {
    const text = q.trim();
    if (text.length < minChars) {
      setErr(`Digite pelo menos ${minChars} letras.`);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    setErr(null);
    setEmpty(false);
    try {
      const res = await search(text);
      if (my !== seq.current) return;
      if (res.length === 1) return choose(res[0]!);
      setItems(res);
      setEmpty(res.length === 0);
      setOpen(true);
    } catch (e) {
      if (my === seq.current) setErr((e as Error).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }

  return (
    <div className="searchbox">
      <div className="row">
        <input
          value={q}
          placeholder={placeholder}
          enterKeyHint="search"
          onChange={(e) => {
            setQ(e.target.value);
            setEmpty(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void run();
            } else if (e.key === "Escape") setOpen(false);
          }}
          onFocus={() => items.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        <button
          type="button"
          className="btn icon"
          title="Buscar"
          aria-label="Buscar"
          disabled={loading}
          onClick={() => void run()}
        >
          {loading ? <Spinner small /> : <Icon name="search" size={18} />}
        </button>
      </div>
      {open && items.length > 0 && (
        <ul className="suggestions">
          {items.map((it) => (
            <li key={it.osmId} onMouseDown={() => choose(it)}>
              <b>{it.name}</b>
              <small>{it.displayName}</small>
            </li>
          ))}
        </ul>
      )}
      {empty && !loading && <div className="hint">Nada encontrado. Tente só rua e número, ou marque no mapa.</div>}
      {err && <div className="error">{err}</div>}
    </div>
  );
}
