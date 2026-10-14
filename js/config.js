// Configuration du site.
// 1. Crée un projet sur https://supabase.com (gratuit)
// 2. Supabase > SQL Editor : colle supabase/schema.sql puis supabase/seed_localities.sql et exécute
// 3. Supabase > Project Settings > API : copie « Project URL » et la clé « anon public » ci-dessous
// Tant que ces deux valeurs sont vides, le site fonctionne en mode local (données gardées dans le navigateur).
window.PY_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  DEFAULT_DRIVER: "yacine",
  STATION: { name: "Station DRUM (Drummondville)", lat: 45.885, lon: -72.49 },
  HOME: { name: "Sherbrooke (domicile)", lat: 45.40, lon: -71.89 },
  FUEL_PRICE: 1.90
};
