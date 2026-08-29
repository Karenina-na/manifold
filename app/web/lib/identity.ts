const ADJECTIVES = ["serene", "quiet", "drifting", "amber", "lucid", "wandering", "gentle", "hidden", "mellow", "velvet", "humble", "vivid", "patient", "sunlit", "moonlit", "paper"];
const CREATURES = ["fox", "heron", "wren", "otter", "lynx", "moth", "finch", "deer", "hare", "owl", "newt", "crow", "koi", "bee", "swift", "dove"];
const IDENTITY_KEY = "manifold.identity";

export type CommentIdentity = { name: string; avatarSeed: string };

export function hashSeed(seed: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function generateName(seed: string) {
  const hash = hashSeed(seed);
  const adjective = ADJECTIVES[hash % ADJECTIVES.length];
  const creature = CREATURES[(hash >>> 8) % CREATURES.length];
  const suffix = ((hash >>> 16) % 1296).toString(36).padStart(2, "0");
  return `${adjective}-${creature}-${suffix}`;
}

export function getIdentity(visitorId: string): CommentIdentity {
  if (typeof window === "undefined") return { name: "", avatarSeed: visitorId };
  try {
    const stored = window.localStorage.getItem(IDENTITY_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<CommentIdentity>;
      return { name: parsed.name ?? generateName(visitorId), avatarSeed: parsed.avatarSeed ?? visitorId };
    }
  } catch {
    // fall through to defaults when storage is unavailable or corrupt
  }
  return { name: generateName(visitorId), avatarSeed: visitorId };
}

export function saveIdentity(identity: Partial<CommentIdentity>, visitorId: string) {
  if (typeof window === "undefined") return;
  const current = getIdentity(visitorId);
  const next = { name: identity.name ?? current.name, avatarSeed: identity.avatarSeed ?? current.avatarSeed };
  try {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(next));
  } catch {
    // storage may be unavailable; identity simply is not persisted
  }
}
