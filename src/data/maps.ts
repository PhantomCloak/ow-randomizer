export type MapCategory =
  | "flashpoint"
  | "control"
  | "hybrid"
  | "escort"
  | "push";

export const mapsByCategory: Record<MapCategory, string[]> = {
  flashpoint: ["New Junk City", "Suravasa", "Aatlis"],
  control: [
    "Antarctic Peninsula",
    "Busan",
    "Ilios",
    "Lijiang Tower",
    "Nepal",
    "Oasis",
    "Samoa",
  ],
  hybrid: [
    "Blizzard World",
    "Eichenwalde",
    "Hollywood",
    "King's Row",
    "Midtown",
    "Numbani",
    "Paraíso",
  ],
  escort: [
    "Circuit Royal",
    "Dorado",
    "Havana",
    "Junkertown",
    "Rialto",
    "Route 66",
    "Shambali Monastery",
    "Watchpoint: Gibraltar",
  ],
  push: ["Colosseo", "Esperança", "New Queen Street", "Runasapi"],
};

export const categoryOrder: MapCategory[] = [
  "flashpoint",
  "control",
  "hybrid",
  "escort",
  "push",
];

export const categoryLabels: Record<MapCategory, string> = {
  flashpoint: "Flashpoint",
  control: "Control",
  hybrid: "Hybrid",
  escort: "Escort",
  push: "Push",
};

// Every map name, flattened, for default selection and pool building.
export const allMaps: string[] = categoryOrder.flatMap((c) => mapsByCategory[c]);
