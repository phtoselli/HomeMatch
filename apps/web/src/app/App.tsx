import { HomePage } from "./pages/HomePage";

/**
 * The app has a single screen. `app/` follows Atomic Design on top of the features:
 *   organisms/  app-level sections that combine several features (top bar)
 *   templates/  page skeletons with slots, no data (MapLayout)
 *   pages/      a template filled with real state from the feature stores (HomePage)
 */
export function App() {
  return <HomePage />;
}
