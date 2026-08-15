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
