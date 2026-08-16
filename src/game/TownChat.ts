// Town chat (spec §16): ambient chatter that makes the town feel alive, and
// the player's line into it. AI-generated when budget allows (≤4 messages per
// game day, §7 efficiency rules), deterministic template fallback otherwise.
// The message bus shape (ChatMessage) is transport-agnostic per §16's
// multiplayer note — this module only produces messages, it doesn't own them.

import type { Adventurer, ChatMessage, GameState } from "../types";
import { makeDecision } from "../entities/AdventurerAI";
import { isRegular } from "./MoraleSystem";

export const MAX_AI_CHAT_PER_DAY = 4;

/** Deterministic ambient lines, personality-tinted. Used as fallback and to
 *  keep the town talkative in No-AI / Light-AI modes. */
export function fallbackChatter(a: Adventurer, s: GameState): string {
  const lines: string[] = [];
  if (s.phase === "morning") {
    lines.push(
      a.personality.riskTolerance > 60
        ? "Beautiful morning for a dungeon crawl!"
        : "Easy morning. Might browse the shop later.",
    );
  }
  if (a.hp < a.maxHp * 0.5) lines.push("Still patching up from that last fight...");
  if (a.gold < 20) lines.push("Purse is feeling light these days.");
  if (a.equipment.weapon) lines.push(`This ${a.equipment.weapon.name} has served me well.`);
  else lines.push("Really ought to get myself a proper weapon.");
  if (isRegular(a)) lines.push("The shop here treats you right, you know.");
  if (a.relationships.shopkeeper < -30) lines.push("Prices at that shop are getting out of hand.");
  const recent = s.recentOutcomes.find((o) => o.adventurerId === a.id && o.day >= s.day - 1);
  if (recent?.monsterDefeated) lines.push(`Did you hear? I took down a ${recent.monsterName}.`);
  // Stable-ish pick that still varies by day and speaker.
  return lines[(s.day * 7 + a.appearance.hair * 3) % lines.length];
}

export interface ChatterState {
  aiMessagesToday: number;
  lastChatterDay: number;
  nextChatterAt: number; // timeOfDay threshold for the next roll
}

export function freshChatterState(): ChatterState {
  return { aiMessagesToday: 0, lastChatterDay: 0, nextChatterAt: 0.15 };
}

/**
 * Called from the engine tick. Occasionally emits a chat message from a
 * random living adventurer: AI-written when mode is "full" and budget
 * remains, template otherwise. Returns the message or null.
 */
export function maybeChatter(s: GameState, cs: ChatterState): ChatMessage | null {
  if (cs.lastChatterDay !== s.day) {
    cs.lastChatterDay = s.day;
    cs.aiMessagesToday = 0;
    cs.nextChatterAt = 0.12 + Math.random() * 0.1;
  }
  if (s.phase === "night" || s.timeOfDay < cs.nextChatterAt) return null;
  cs.nextChatterAt = s.timeOfDay + 0.12 + Math.random() * 0.15; // a few per day

  const speakers = s.adventurers.filter((a) => a.alive && a.state !== "adventuring");
  if (speakers.length === 0) return null;
  const speaker = speakers[Math.floor(Math.random() * speakers.length)];

  const msg: ChatMessage = {
    id: `chat-${s.day}-${speaker.id}-${Math.round(s.timeOfDay * 1000)}`,
    senderId: speaker.id,
    senderName: speaker.name,
    type: "ambient",
    content: fallbackChatter(speaker, s),
    timestamp: s.timeOfDay,
    day: s.day,
  };

  // Full-AI mode upgrades the line asynchronously (§7 latency rule: the
  // template ships immediately; AI text replaces it in place if it arrives).
  if (s.aiMode === "full" && cs.aiMessagesToday < MAX_AI_CHAT_PER_DAY) {
    cs.aiMessagesToday += 1;
    const context =
      `It is ${s.phase} on day ${s.day} in town. Say one short line of ambient chatter ` +
      `(1-2 sentences) as yourself — about your plans, the shop, a recent fight, or town life.`;
    void makeDecision("shop_flavor", speaker, context, s.tokenBudget).then((d) => {
      if (d && "text" in d) msg.content = d.text;
    });
  }
  return msg;
}

/**
 * The player says something in chat (§16). Their message is appended by the
 * caller; this produces the reactive responses. Deterministic keyword
 * routing picks who responds; AI writes the reply when available.
 * Returns response messages (possibly empty). Responses arrive with a small
 * in-fiction delay applied by the engine.
 */
export function playerChatResponders(s: GameState, playerText: string): Adventurer[] {
  const text = playerText.toLowerCase();
  const alive = s.adventurers.filter((a) => a.alive && a.state !== "adventuring");
  if (alive.length === 0) return [];

  // Directly named adventurer answers.
  const named = alive.filter((a) => text.includes(a.name.split(" ")[0].toLowerCase()));
  if (named.length > 0) return named.slice(0, 1);

  // Stock talk interests whoever needs gear; danger talk interests the cautious.
  if (/(sword|shield|armor|potion|stock|shipment|sale)/.test(text)) {
    const interested = alive.filter(
      (a) => !a.equipment.weapon || !a.equipment.armor || a.personality.preferredItems.length > 0,
    );
    return interested.slice(0, 2);
  }
  if (/(careful|danger|golem|cave|monster|warn)/.test(text)) {
    return alive.filter((a) => a.personality.riskTolerance < 50).slice(0, 2);
  }
  // Otherwise one random adventurer humors the shopkeeper.
  return [alive[Math.floor(Math.random() * alive.length)]];
}

/** Deterministic reply when AI is unavailable — varied by personality so two
 *  responders never sound like the same person (issue #33, §17). */
export function fallbackReply(a: Adventurer, playerText: string): string {
  const text = playerText.toLowerCase();
  const flavor = a.appearance.skin + a.appearance.hair; // stable per-adventurer variety
  if (/(sword|shield|armor|potion|stock|shipment|sale)/.test(text)) {
    if (a.gold <= 40) {
      return pick(flavor, [
        "Wish I had the coin for it.",
        "Maybe after my next haul.",
        "You take IOUs?",
      ]);
    }
    const byStyle: Record<Adventurer["personality"]["spendingStyle"], string[]> = {
      impulsive: ["Save one for me — I'm on my way!", "Sold. Don't let anyone touch it."],
      careful: ["I'll come take a look and judge for myself.", "Depends on the price, as always."],
      frugal: ["At a fair price, mind you.", "If it's cheaper than the last lot, I'm interested."],
      generous: ["Good on you — I'll swing by.", "I'll bring a friend, you deserve the custom."],
    };
    return pick(flavor, byStyle[a.personality.spendingStyle]);
  }
  if (/(careful|danger|golem|cave|monster|warn)/.test(text)) {
    return a.personality.riskTolerance > 60
      ? pick(flavor, ["Sounds like a challenge.", "Now I HAVE to see it.", "Tougher the fight, better the loot."])
      : pick(flavor, ["Appreciate the warning.", "That settles it — forest for me today.", "Duly noted. I like my limbs attached."]);
  }
  return pick(flavor, [
    "Ha — fair enough, shopkeeper.",
    "If you say so.",
    "Heard, loud and clear.",
  ]);
}

function pick(seed: number, options: string[]): string {
  return options[seed % options.length];
}
