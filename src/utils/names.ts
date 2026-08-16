// Procedural adventurer name generation.

const FIRST = [
  "Bren", "Mira", "Grok", "Luna", "Tavi", "Oswin", "Kessa", "Doran",
  "Ryla", "Fenn", "Isolde", "Marek", "Petra", "Silas", "Wren", "Aldric",
];

const EPITHETS = [
  "the Bold", "Swiftfoot", "the Wary", "Brightstaff", "Ironhand", "the Quiet",
  "Quickblade", "the Stubborn", "Emberborn", "the Lucky", "Greycloak", "Halfpint",
];

export function generateName(rng: () => number = Math.random): string {
  const first = FIRST[Math.floor(rng() * FIRST.length)];
  const epithet = EPITHETS[Math.floor(rng() * EPITHETS.length)];
  return `${first} ${epithet}`;
}

/** Generate a name whose FIRST name collides with none of `taken` — two Brens
 *  in one town confuses both the player and named chat routing. */
export function generateUniqueName(takenNames: string[]): string {
  const takenFirsts = new Set(takenNames.map((n) => n.split(" ")[0]));
  const available = FIRST.filter((f) => !takenFirsts.has(f));
  if (available.length === 0) return generateName(); // town bigger than the name pool
  const first = available[Math.floor(Math.random() * available.length)];
  const epithet = EPITHETS[Math.floor(Math.random() * EPITHETS.length)];
  return `${first} ${epithet}`;
}
