import { z } from "zod";
import * as cheerio from "cheerio";

// Schemas
export const characterSchema = z.string().min(1);
export const commandSchema = z.string().min(1);
export const moveSchema = z.object({
  moveNumber: z.number(),
  command: z.string(),
  name: z.string().optional(),
  hitLevel: z.string(),
  damage: z.string(),
  startup: z.string().optional(),
  block: z.string(),
  hit: z.string(),
  counterHit: z.string(),
  notes: z.string().optional(),
  wavuId: z.string().optional(),
  tags: z.record(z.string()).optional(),
  transitions: z.array(z.string()).optional(),
  recovery: z.string().optional(),
  strategicImportance: z.number().optional()
});

// Fetch & cache
const cache = new Map<string, { data: unknown; expires: number }>();
const TTL = 10 * 60 * 1000; // 10 minutes

async function fetchJson<T>(url: string): Promise<T> {
  const now = Date.now();
  const cached = cache.get(url);
  if (cached && cached.expires > now) return cached.data as T;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`TekkenDocs responded ${res.status}`);
  const data = (await res.json()) as T;
  cache.set(url, { data, expires: now + TTL });
  return data;
}

// Tekken 8 character roster - update this list when new characters are added
const TEKKEN8_CHARACTERS = [
  "alisa",
  "anna",
  "asuka",
  "armor-king",
  "azucena",
  "bryan",
  "claudio",
  "clive",
  "devil-jin",
  "dragunov",
  "eddy",
  "fahkumram",
  "feng",
  "heihachi",
  "hwoarang",
  "jack-8",
  "jin",
  "jun",
  "kazuya",
  "king",
  "kuma",
  "lars",
  "law",
  "lee",
  "leo",
  "leroy",
  "lidia",
  "lili",
  "nina",
  "panda",
  "paul",
  "raven",
  "reina",
  "shaheen",
  "steve",
  "victor",
  "xiaoyu",
  "yoshimitsu",
  "zafina",
  // Add DLC characters here as they're released
] as const;

// Error types for better error handling
export interface TekkenError {
  error: string;
  code: "CHARACTER_NOT_FOUND" | "MOVE_NOT_FOUND" | "NETWORK_ERROR" | "INVALID_INPUT";
  input: any;
  suggestions?: Array<{ name: string; similarity: number }>;
  didYouMean?: string;
  action?: string;
  alternatives?: string[];
}

/**
 * Calculate Levenshtein distance between two strings for fuzzy matching
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Calculate similarity score between two strings (0-1)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
  const maxLen = Math.max(str1.length, str2.length);
  return 1 - distance / maxLen;
}

/**
 * Find similar character names for fuzzy matching
 */
export function findSimilarCharacters(input: string, limit: number = 3): Array<{ name: string; similarity: number }> {
  return TEKKEN8_CHARACTERS
    .map(char => ({
      name: char,
      similarity: calculateSimilarity(input, char)
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Create a helpful error message when character is not found
 */
export function createCharacterNotFoundError(input: string): TekkenError {
  const suggestions = findSimilarCharacters(input);
  const bestMatch = suggestions[0];

  return {
    error: `Character "${input}" not found`,
    code: "CHARACTER_NOT_FOUND",
    input,
    suggestions,
    didYouMean: bestMatch.similarity > 0.6 ? bestMatch.name : undefined,
    action: bestMatch.similarity > 0.6
      ? `Did you mean "${bestMatch.name}"? The server can auto-correct this for you.`
      : `Please use listCharacters() to see all available characters.`,
    alternatives: [
      "Use listCharacters() to see all available characters",
      `Similar names: ${suggestions.map(s => `${s.name} (${Math.round(s.similarity * 100)}% match)`).join(", ")}`
    ]
  };
}

export async function listCharacters(): Promise<string[]> {
  return [...TEKKEN8_CHARACTERS];
}

/**
 * Check if a character name is valid/supported
 */
export function isValidCharacter(characterName: string): boolean {
  return TEKKEN8_CHARACTERS.includes(characterName.toLowerCase() as any);
}

export type TekkenMove = z.infer<typeof moveSchema>;

/**
 * Parse frame data string to number (e.g., "+5" -> 5, "-12" -> -12, "i14" -> 14)
 */
function parseFrameData(frameStr: string | undefined): number | null {
  if (!frameStr || frameStr === "") return null;

  // Handle startup frames (i14, i15~17)
  if (frameStr.startsWith("i")) {
    const match = frameStr.match(/i(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  // Handle positive/negative frames (+5, -12, +23a)
  const match = frameStr.match(/([+-]?\d+)/);
  return match ? parseInt(match[1]) : null;
}

/**
 * Check if a frame data string indicates a launcher (has "a" suffix and value >= 20)
 * Example: "+23a" -> true, "+15a" -> false, "+25" -> false
 */
function isLauncher(frameStr: string | undefined): boolean {
  if (!frameStr) {
    return false;
  }
  if (frameStr === "") return false;

  // Check if it has "a" suffix (indicates airborne)
  if (!frameStr.toLowerCase().includes("a")) return false;

  // Extract the number and check if >= 20
  const match = frameStr.match(/([+-]?\d+)/);
  if (!match) return false;

  const frameValue = parseInt(match[1]);
  return frameValue >= 20;
}

function calculateStrategicImportance(move: TekkenMove): number {
    let score = 0;

    const block = parseFrameData(move.block);
    const startup = parseFrameData(move.startup);
    const hit = parseFrameData(move.hit);

    // Safety (Block Advantage): Max 15
    if (block !== null) {
        if (block > 0) score += 15; // Plus on block
        else if (block >= -4) score += 10; // Very safe
        else if (block >= -9) score += 5;  // Standard safe
        else if (block >= -13) score -= 5; // Jab punishable
        else if (block >= -15) score -= 10; // Launch punishable
        else score -= 15; // Heavily punishable
    }

    // Speed (Startup): Max 10
    if (startup !== null) {
        if (startup <= 12) score += 10; // Very fast (punishers, pokes)
        else if (startup <= 14) score += 7; // Fast
        else if (startup <= 16) score += 5; // Decent speed (launchers)
        else if (startup <= 20) score += 2; // A bit slow
        else score -= 2; // Slow and risky
    }

    // Reward (Hit/Counter-Hit): Max 20
    const isHitLauncher = isLauncher(move.hit);
    const isCHLauncher = isLauncher(move.counterHit);
    if (isHitLauncher || isCHLauncher) {
        score += 20; // Launchers are the highest reward
    } else if (hit !== null && hit > 15) {
        score += 10; // High advantage leads to followups
    }
    if ((move.hit && move.hit.includes('c')) || (move.counterHit && move.counterHit.includes('c'))) {
        score += 5; // Forcing crouch is strong
    }

    // Utility (Tags & Properties): Potentially high score
    let utilityScore = 0;
    if (move.tags) {
        if (move.tags.he) utilityScore += 15; // Heat Engagers are vital
        if (move.tags.pc) utilityScore += 7;  // Power Crush has situational use
        if (move.tags.trn) utilityScore += 5; // Tornado is essential for combos
        if (move.tags.bbr) utilityScore += 5; // Wall breaks are great
    }
    if (move.notes?.toLowerCase().includes('homing')) utilityScore += 10; // Homing is very strong
    if (move.transitions?.includes('DSS')) utilityScore += 12; // Stance transitions are core to the character
    if (move.notes?.toLowerCase().includes('guaranteed')) utilityScore += 15; // Guaranteed followups are top-tier
    score += utilityScore;

    // Hit Level
    if (move.hitLevel.includes('m')) score += 5; // Mids are generally safer and more valuable
    if (move.hitLevel.includes('l')) {
        if (isHitLauncher || isCHLauncher) {
            score += 15; // Low launchers are rare and powerful
        } else {
            score += 3; // Low pokes are good for mixups
        }
    }
    if (move.hitLevel.includes('h') && startup !== null && startup > 12) {
        score -= 3; // Slower highs are a liability
    }

    return score;
}

export async function getMovelist(char: string): Promise<TekkenMove[]> {
  const lowerChar = char.toLowerCase();
  characterSchema.parse(lowerChar);

  // Check if character is in our known list
  if (!isValidCharacter(lowerChar)) {
    const error = createCharacterNotFoundError(lowerChar);
    throw new Error(JSON.stringify(error, null, 2));
  }

  const url = `https://tekkendocs.com/api/t8/${lowerChar}/framedata`;
  const response = await fetchJson<any>(url);

  // TekkenDocs API returns an object with framesNormal array
  if (response && Array.isArray(response.framesNormal)) {
    // Add strategic importance score
    const movesWithScores = response.framesNormal.map((move: any) => ({
        ...move,
        strategicImportance: calculateStrategicImportance(move)
    }));
    return movesWithScores;
  } else {
    console.error(`Unexpected API response structure for ${lowerChar}:`, response);
    throw new Error(`Invalid response structure from TekkenDocs API for character: ${lowerChar}`);
  }
}

export async function getMove(
  char: string,
  command: string
): Promise<TekkenMove | undefined> {
  try {
    const lowerChar = char.toLowerCase();
    commandSchema.parse(command);
    const moves = await getMovelist(lowerChar);

    if (!Array.isArray(moves)) {
      throw new Error(`getMovelist returned non-array for character: ${lowerChar}`);
    }

    return moves.find((m) =>
      m && m.command && m.command.toLowerCase() === command.toLowerCase()
    );
  } catch (error) {
    console.error(`Error in getMove for ${char}/${command}:`, error);
    throw error;
  }
}

/**
 * Search and filter moves based on criteria
 */
export interface SearchMovesFilters {
  hitLevel?: "h" | "m" | "l" | "s";
  minDamage?: number;
  maxStartup?: number;
  minBlock?: number;  // For safe moves (e.g., -10 or better)
  maxBlock?: number;  // For unsafe moves
  minHit?: number;    // For plus frames
  minCounterHit?: number;
  counterHitLaunchers?: boolean;  // Find moves with counterHit value like "+23a" (>= +20a)
  safeOnBlock?: boolean;  // Find moves that are -10 or better on block
  hasTag?: string;    // "he" for heat engagers, "heat" for heat moves (H. commands) + heat tags, "chl"/"launcher" for counter hit launchers, "gb"/"guard break", "rb"/"reversal break", "charge"/"hold" for charge moves, "safe" for safe moves, "tornado", etc.
  limit?: number;     // Limit results
}

export async function searchMoves(
  character: string,
  filters: SearchMovesFilters
): Promise<TekkenMove[]> {
  const lowerChar = character.toLowerCase();
  characterSchema.parse(lowerChar);

  if (!isValidCharacter(lowerChar)) {
    const error = createCharacterNotFoundError(lowerChar);
    throw new Error(JSON.stringify(error, null, 2));
  }

  const moves = await getMovelist(lowerChar);

  const filtered = moves.filter(move => {
    // Hit level filter
    if (filters.hitLevel && !move.hitLevel.includes(filters.hitLevel)) {
      return false;
    }

    // Damage filter (parse first damage value)
    if (filters.minDamage !== undefined) {
      const damageMatch = move.damage.match(/(\d+)/);
      const damage = damageMatch ? parseInt(damageMatch[1]) : 0;
      if (damage < filters.minDamage) return false;
    }

    // Startup filter
    if (filters.maxStartup !== undefined && move.startup) {
      const startup = parseFrameData(move.startup);
      if (startup === null || startup > filters.maxStartup) return false;
    }

    // Block advantage filters
    if (filters.minBlock !== undefined) {
      const block = parseFrameData(move.block);
      if (block === null || block < filters.minBlock) return false;
    }

    if (filters.maxBlock !== undefined) {
      const block = parseFrameData(move.block);
      if (block === null || block > filters.maxBlock) return false;
    }

    // Hit advantage filter
    if (filters.minHit !== undefined) {
      const hit = parseFrameData(move.hit);
      if (hit === null || hit < filters.minHit) return false;
    }

    // Counter hit filter
    if (filters.minCounterHit !== undefined) {
      const ch = parseFrameData(move.counterHit);
      if (ch === null || ch < filters.minCounterHit) return false;
    }

    // Counter hit launcher filter
    if (filters.counterHitLaunchers === true) {
      if (!isLauncher(move.counterHit)) return false;
    }

    // Safe on block filter (-10 or better)
    if (filters.safeOnBlock === true) {
      const block = parseFrameData(move.block);
      if (block === null || block < -10) return false;
    }

        // Tag and special move filter (heat engager, tornado, heat moves, counter hit launchers, guard break, reversal break, charge moves, safe moves, etc.)
    if (filters.hasTag) {
      const searchTag = filters.hasTag.toLowerCase();

      // Check for counter hit launchers
      if (searchTag === "chl" || searchTag === "launcher" || searchTag === "ch launcher") {
        if (isLauncher(move.counterHit)) return true;
      }

      // Check for charge moves (in notes field)
      if (searchTag === "charge" || searchTag === "hold") {
        if (move.notes && (
          move.notes.toLowerCase().includes("charge") ||
          move.notes.toLowerCase().includes("hold") ||
          move.notes.match(/\d+f charge/) || // "26f charge"
          move.notes.match(/\d+~\d+f charge/) // "0~26f charge"
        )) {
          return true;
        }
      }

      // Check for safe moves (-10 or better on block)
      if (searchTag === "safe") {
        const block = parseFrameData(move.block);
        if (block !== null && block >= -10) return true;
      }

      // Check for heat moves (commands starting with "H.")
      if (searchTag === "heat" || searchTag === "h") {
        const isHeatMove = move.command.startsWith("H.");
        if (isHeatMove) return true; // Found a heat move, include it
      }

      // Check tags if move has them
      if (move.tags) {
        const hasRequiredTag = Object.keys(move.tags).some(tag => {
          const tagLower = tag.toLowerCase();
          // Support both exact matches and common abbreviations
          if (tagLower === searchTag) return true;
          if (searchTag === "he" && tagLower === "heat engager") return true;
          if (searchTag === "heat" && tagLower.includes("heat")) return true;
          if (searchTag === "tornado" && tagLower === "tornado") return true;
          if (searchTag === "wall" && tagLower.includes("wall")) return true;
          if (searchTag === "screw" && tagLower.includes("screw")) return true;
          if (searchTag === "gb" && tagLower.includes("guard break")) return true;
          if (searchTag === "guard break" && tagLower.includes("guard break")) return true;
          if (searchTag === "rb" && tagLower.includes("reversal break")) return true;
          if (searchTag === "reversal break" && tagLower.includes("reversal break")) return true;
          if (searchTag === "charge" && (tagLower.includes("charge") || tagLower.includes("hold"))) return true;
          if (searchTag === "hold" && (tagLower.includes("charge") || tagLower.includes("hold"))) return true;
          return false;
        });
        if (hasRequiredTag) return true; // Found required tag, include it
      }

      // For heat search, we already checked command above
      // For counter hit launcher search, we already checked above
      // For safe search, we already checked above
      // For other searches, if no tags found, filter out
      if (searchTag !== "heat" && searchTag !== "h" &&
          searchTag !== "chl" && searchTag !== "launcher" && searchTag !== "ch launcher" &&
          searchTag !== "gb" && searchTag !== "guard break" &&
          searchTag !== "rb" && searchTag !== "reversal break" &&
          searchTag !== "charge" && searchTag !== "hold" &&
          searchTag !== "safe") {
        return false;
      }

      // For heat/launcher/guard break/reversal break/charge/safe searches, if not a special move and no relevant tags, filter out
      return false;
    }

    return true;
  });

  // Apply limit
  return filters.limit ? filtered.slice(0, filters.limit) : filtered;
}

/**
 * Character overview data from Wavu Wiki
 */
export interface CharacterOverview {
  name: string;
  bio?: {
    fullName?: string;
    nationality?: string;
    fightingStyle?: string;
    description?: string;
  };
  strengths?: string[];
  weaknesses?: string[];
  keyTechniques?: string[];
  playstyle?: string;
  archetype?: string;
  difficulty?: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
  lastUpdated?: string;
  source: 'wavu-wiki';
}

/**
 * Get character overview from Wavu Wiki
 */
export async function getCharacterOverview(character: string): Promise<CharacterOverview> {
  const lowerChar = character.toLowerCase();
  characterSchema.parse(lowerChar);

  if (!isValidCharacter(lowerChar)) {
    const error = createCharacterNotFoundError(lowerChar);
    throw new Error(JSON.stringify(error, null, 2));
  }

  const cacheKey = `overview_${lowerChar}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached.data as CharacterOverview;
  }

  try {
    const overview = await fetchCharacterOverview(lowerChar);
    cache.set(cacheKey, { data: overview, expires: Date.now() + TTL });
    return overview;
  } catch (error) {
    console.error(`Failed to fetch overview for ${character}:`, error);
    throw new Error(`Failed to fetch character overview for ${character}`);
  }
}

/**
 * Fetch character overview from Wavu Wiki
 */
async function fetchCharacterOverview(character: string): Promise<CharacterOverview> {
  const wavuUrl = `https://wavu.wiki/t/${encodeURIComponent(character)}`;

  try {
    const response = await fetch(wavuUrl, {
      headers: {
        'User-Agent': 'Tekken-MCP-Server/1.0.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    return parseCharacterOverview(character, html);
  } catch (error) {
    console.error(`Error fetching Wavu Wiki page for ${character}:`, error);
    throw error;
  }
}

/**
 * Parse character overview from Wavu Wiki HTML
 */
function parseCharacterOverview(character: string, html: string): CharacterOverview {
  const $ = cheerio.load(html);

  const overview: CharacterOverview = {
    name: character,
    source: 'wavu-wiki',
    lastUpdated: new Date().toISOString()
  };

  try {
    // Extract main character description (first paragraph after title)
    const mainParagraphs = $('p').filter((i, el) => {
      const text = $(el).text().trim();
      return text.length > 50 && !text.startsWith('This page is for');
    });

    if (mainParagraphs.length > 0) {
      const mainDescription = $(mainParagraphs[0]).text().trim();
      overview.bio = {
        description: mainDescription
      };

      // Extract archetype from description
      const archetypeMatch = mainDescription.match(/(close range|rushdown|zoner|grappler|mixup|pressure|keepout|defensive|poking-based|slide archetype|stance|mishima)/gi);
      if (archetypeMatch) {
        overview.archetype = archetypeMatch.join(', ');
      }

      // Extract playstyle keywords
      if (mainDescription.toLowerCase().includes('close range') || mainDescription.toLowerCase().includes('aggressive')) {
        overview.playstyle = 'Rushdown/Aggressive';
      } else if (mainDescription.toLowerCase().includes('defensive') || mainDescription.toLowerCase().includes('turtle')) {
        overview.playstyle = 'Defensive';
      } else if (mainDescription.toLowerCase().includes('grappler') || mainDescription.toLowerCase().includes('throw')) {
        overview.playstyle = 'Grappler';
      } else if (mainDescription.toLowerCase().includes('zoning') || mainDescription.toLowerCase().includes('keepout')) {
        overview.playstyle = 'Zoning/Keepout';
      } else if (mainDescription.toLowerCase().includes('mixup') || mainDescription.toLowerCase().includes('50/50')) {
        overview.playstyle = 'Mixup Heavy';
      } else if (mainDescription.toLowerCase().includes('poking')) {
        overview.playstyle = 'Poking/Neutral';
      }
    }

    // Extract strengths - look for "Strengths" heading and following content
    const strengthsHeader = $('h1:contains("Strengths"), h2:contains("Strengths"), h3:contains("Strengths")').first();
    if (strengthsHeader.length > 0) {
      // Try multiple approaches to find the list
      let strengthsList = strengthsHeader.next('ul').find('li');

      // If not found, look for the next sibling elements until we find a ul
      if (strengthsList.length === 0) {
        let nextElement = strengthsHeader.next();
        while (nextElement.length > 0 && !nextElement.is('h1, h2, h3')) {
          if (nextElement.is('ul')) {
            strengthsList = nextElement.find('li');
            break;
          }
          nextElement = nextElement.next();
        }
      }

      // If still not found, try looking for list items anywhere after the header
      if (strengthsList.length === 0) {
        strengthsList = strengthsHeader.nextUntil('h1, h2, h3').find('li');
      }

      if (strengthsList.length > 0) {
        overview.strengths = strengthsList.map((_, el) => $(el).text().trim()).get().filter(s => s.length > 0);
      }
    }

    // Extract weaknesses - look for "Weaknesses" heading and following content
    const weaknessesHeader = $('h1:contains("Weaknesses"), h2:contains("Weaknesses"), h3:contains("Weaknesses")').first();
    if (weaknessesHeader.length > 0) {
      // Try multiple approaches to find the list
      let weaknessesList = weaknessesHeader.next('ul').find('li');

      // If not found, look for the next sibling elements until we find a ul
      if (weaknessesList.length === 0) {
        let nextElement = weaknessesHeader.next();
        while (nextElement.length > 0 && !nextElement.is('h1, h2, h3')) {
          if (nextElement.is('ul')) {
            weaknessesList = nextElement.find('li');
            break;
          }
          nextElement = nextElement.next();
        }
      }

      // If still not found, try looking for list items anywhere after the header
      if (weaknessesList.length === 0) {
        weaknessesList = weaknessesHeader.nextUntil('h1, h2, h3').find('li');
      }

      if (weaknessesList.length > 0) {
        overview.weaknesses = weaknessesList.map((_, el) => $(el).text().trim()).get().filter(s => s.length > 0);
      }
    }

                // Extract key techniques from various possible structures
    const keyTechHeader = $('h1:contains("Key techniques"), h2:contains("Key techniques"), h3:contains("Key techniques")').first();
    if (keyTechHeader.length > 0) {
      const techniques: string[] = [];

      // First try: Look for table after the header (including all following tables in the section)
      const allTablesInSection = keyTechHeader.nextUntil('h1, h2, h3').find('table');
      let foundTechniques = false;

      allTablesInSection.each((_, table) => {
        if (foundTechniques) return; // Skip if we already found techniques

        const $table = $(table);
        // Look for table with technique-like content
        $table.find('tr').each((i, row) => {
          const cells = $(row).find('td');
          if (cells.length > 0) {
            const firstCell = cells.first();
            const technique = firstCell.text().trim();

            // More permissive technique detection
            if (technique &&
                technique.length > 2 &&
                technique.length < 50 && // Not too long
                !technique.match(/^\d+$/) && // Not pure numbers
                !technique.match(/★+/) && // Not star ratings
                !technique.toLowerCase().includes('importance') &&
                !technique.toLowerCase().includes('value') &&
                !technique.toLowerCase().includes('dexterity') &&
                !technique.toLowerCase().includes('rhythm')) {

              // Check if this looks like a technique name
              if (technique.match(/^[A-Z][a-z]/) || // Starts with capital letter
                  technique.includes('Mixup') ||
                  technique.includes('Poking') ||
                  technique.includes('Sliding') ||
                  technique.includes('Cancel') ||
                  technique.includes('Stance') ||
                  technique.includes('Wave')) {
                techniques.push(technique);
                foundTechniques = true;
              }
            }
          }
        });
      });

      // Second try: Look for immediate table after header
      if (techniques.length === 0) {
        const nextTable = keyTechHeader.nextAll('table').first();
        if (nextTable.length > 0) {
          // Try different table parsing strategies
          nextTable.find('tr').each((i, row) => {
            const $row = $(row);
            // Try first cell
            let technique = $row.find('td').first().text().trim();

            // If first cell doesn't work, try all cells
            if (!technique || technique.length < 3) {
              $row.find('td').each((_, cell) => {
                const cellText = $(cell).text().trim();
                if (cellText && cellText.length > 2 && cellText.length < 30) {
                  technique = cellText;
                  return false; // Break loop
                }
              });
            }

            if (technique && technique.length > 2 && !technique.match(/^\d+$/)) {
              techniques.push(technique);
            }
          });
        }
      }

      // Third try: Look for any text patterns that mention common techniques
      if (techniques.length === 0) {
        const sectionText = keyTechHeader.nextUntil('h1, h2, h3').text();
        const commonTechniques = ['Poking', 'Crouch Mixup', 'Sliding', 'Wave dash', 'Stance', 'Cancel', 'Just frame'];
        commonTechniques.forEach(tech => {
          if (sectionText.toLowerCase().includes(tech.toLowerCase())) {
            techniques.push(tech);
          }
        });
      }

            // Fourth try: Use direct keywords from the page content
      if (techniques.length === 0) {
        const pageText = $('body').text();
        const keywordPatterns = [
          /Poking/gi,
          /Crouch Mixup/gi,
          /Sliding/gi,
          /Wave dash/gi,
          /Stance/gi,
          /Cancel/gi,
          /Just frame/gi,
          /Mixup/gi,
          /Pressure/gi,
          /Rushdown/gi,
          /Counterhit/gi,
          /Launcher/gi,
          /Combo/gi,
          /Oki/gi,
          /Neutral/gi,
          /Whiff/gi,
          /Sidestep/gi,
          /Backdash/gi,
          /Hellsweep/gi,
          /Wavedash/gi,
          /Electric/gi,
          /Tsunami/gi,
          /D\+3/gi,
          /D\+4/gi,
          /DSS/gi,
          /3\+4/gi,
          /b\+4/gi,
        ];

        keywordPatterns.forEach(pattern => {
          const matches = pageText.match(pattern);
          if (matches) {
            techniques.push(matches[0]);
          }
        });
      }

      // Fallback: Try to extract from a simple list structure
      if (techniques.length === 0) {
        const techniquesList = keyTechHeader.nextUntil('h1, h2, h3').find('li');
        if (techniquesList.length > 0) {
          techniquesList.each((_, el) => {
            const technique = $(el).text().trim();
            if (technique && technique.length > 2 && technique.length < 50) {
              techniques.push(technique);
            }
          });
        }
      }

      // Character-specific techniques based on common knowledge
      if (character.toLowerCase() === 'law') {
        const lawTechniques = ['Dragon Slide', 'Dragon Sign Stance', 'Somersault Kick', 'Junkyard', 'DSS mixups', 'Slide mixup'];
        lawTechniques.forEach(tech => {
          if ($('body').text().toLowerCase().includes(tech.toLowerCase()) ||
              $('body').text().toLowerCase().includes('dss') ||
              $('body').text().toLowerCase().includes('slide')) {
            techniques.push(tech);
          }
        });
      } else if (character.toLowerCase() === 'steve') {
        techniques.push('Flicker Stance', 'Peekaboo', 'Ducking', 'Sonic Fang');
      } else if (character.toLowerCase() === 'nina') {
        techniques.push('Ivory Cutter', 'Chain Throws', 'Sidestep Cancels');
      } else if (character.toLowerCase() === 'hwoarang') {
        techniques.push('Flamingo Stance', 'Left Foot Forward', 'Right Foot Forward');
      } else if (character.toLowerCase() === 'bryan') {
        techniques.push('Taunt', 'Snake Edge', 'Jet Upper');
      } else if (character.toLowerCase() === 'jin') {
        techniques.push('Electric Wind God Fist', 'Wavedash', 'Hellsweep');
      } else if (character.toLowerCase() === 'kazuya') {
        techniques.push('Electric Wind God Fist', 'Wavedash', 'Hellsweep', 'Devil Transform');
      }

      // Generic techniques from page content
      if (techniques.length === 0) {
        const commonTechniques = ['Poking', 'Mixup', 'Pressure', 'Combo', 'Launcher', 'Stance'];
        commonTechniques.forEach(tech => {
          if ($('body').text().toLowerCase().includes(tech.toLowerCase())) {
            techniques.push(tech);
          }
        });
      }

      if (techniques.length > 0) {
        overview.keyTechniques = [...new Set(techniques)]; // Remove duplicates
      }
    }

            // Extract additional bio info from info table (try multiple tables)
    const allTables = $('table');
    let fightingStyleInfo = '';

    allTables.each((_, table) => {
      const $table = $(table);

      // Look for character info in tables
      const heatInfo = $table.find('tr:contains("Heat")').find('td').last().text().trim();
      const stancesInfo = $table.find('tr:contains("Stances")').find('td').last().text().trim();
      const heatEngagers = $table.find('tr:contains("Heat Engagers")').find('td').last().text().trim();
      const heatSmash = $table.find('tr:contains("Heat Smash")').find('td').last().text().trim();
      const fastest = $table.find('tr:contains("Fastest")').find('td').last().text().trim();
      const fastestLaunch = $table.find('tr:contains("Fastest launch"), tr:contains("Launch")').find('td').last().text().trim();
      const chLaunch = $table.find('tr:contains("CH launch")').find('td').last().text().trim();

      // Try alternative selectors for case variations
      const heatInfo2 = $table.find('tr:contains("heat")').find('td').last().text().trim();
      const stancesInfo2 = $table.find('tr:contains("stance")').find('td').last().text().trim();

      let tableInfo = '';
      if (heatInfo || heatInfo2) tableInfo += `Heat: ${heatInfo || heatInfo2}. `;
      if (heatSmash) tableInfo += `Heat Smash: ${heatSmash}. `;
      if (stancesInfo || stancesInfo2) {
        const stances = stancesInfo || stancesInfo2;
        if (stances && stances !== '' && stances !== '(none)' && stances !== 'none') {
          tableInfo += `Stances: ${stances}. `;
        }
      }
      if (heatEngagers) tableInfo += `Heat Engagers: ${heatEngagers}. `;
      if (fastest) tableInfo += `Fastest: ${fastest}. `;
      if (fastestLaunch) tableInfo += `Fastest Launch: ${fastestLaunch}. `;
      if (chLaunch) tableInfo += `CH Launch: ${chLaunch}. `;

            if (tableInfo.trim()) {
        fightingStyleInfo += tableInfo;
      }
    });

    if (fightingStyleInfo.trim()) {
      overview.bio = overview.bio || {};
      // Clean up the fighting style info formatting
      let cleanedFightingStyle = fightingStyleInfo.trim()
        .replace(/\n/g, ' ') // Replace newlines with spaces
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .replace(/\{\{\{[^}]*\}\}\}/g, 'i15') // Replace wiki template placeholders
        .replace(/\. \./g, '.'); // Fix double periods
      overview.bio.fightingStyle = cleanedFightingStyle;
    }

    // Alternative approach: Look for specific content patterns if main sections weren't found
    if (!overview.strengths || overview.strengths.length === 0) {
      // Try to find bullet points or lists that might contain strengths
      const allText = $('body').text();
      if (allText.includes('Strong') || allText.includes('Good') || allText.includes('Excellent')) {
        // Try to find content after "Strengths" in the text
        const strengthsMatch = allText.match(/Strengths[:\s]*([\s\S]*?)(?:Weaknesses|Key techniques|External|$)/i);
        if (strengthsMatch) {
          const strengthsText = strengthsMatch[1];
          // Extract bullet points or sentences
          const potentialStrengths = strengthsText.match(/[•*\-]?\s*([A-Z][^•*\-\n\r]+)/g);
          if (potentialStrengths) {
            overview.strengths = potentialStrengths.map(s => s.replace(/^[•*\-\s]+/, '').trim()).filter(s => s.length > 10);
          }
        }
      }
    }

    if (!overview.weaknesses || overview.weaknesses.length === 0) {
      // Try to find content after "Weaknesses" in the text
      const allText = $('body').text();
      const weaknessesMatch = allText.match(/Weaknesses[:\s]*([\s\S]*?)(?:Key techniques|External|$)/i);
      if (weaknessesMatch) {
        const weaknessesText = weaknessesMatch[1];
        // Extract bullet points or sentences
        const potentialWeaknesses = weaknessesText.match(/[•*\-]?\s*([A-Z][^•*\-\n\r]+)/g);
        if (potentialWeaknesses) {
          overview.weaknesses = potentialWeaknesses.map(s => s.replace(/^[•*\-\s]+/, '').trim()).filter(s => s.length > 10);
        }
      }
    }

    // Determine difficulty based on character complexity and description
    const allText = $('body').text().toLowerCase();
    if (allText.includes('beginner') || allText.includes('easy') || allText.includes('accessible')) {
      overview.difficulty = 'Beginner';
    } else if (allText.includes('intermediate')) {
      overview.difficulty = 'Intermediate';
    } else if (allText.includes('advanced') || allText.includes('expert') || allText.includes('challenging execution')) {
      overview.difficulty = 'Advanced';
    } else {
      // Guess based on key techniques
      if (overview.keyTechniques) {
        const complexTechniques = overview.keyTechniques.filter(t =>
          t.toLowerCase().includes('stance') ||
          t.toLowerCase().includes('cancel') ||
          t.toLowerCase().includes('just frame') ||
          t.toLowerCase().includes('wave') ||
          t.toLowerCase().includes('mixup')
        );

        if (complexTechniques.length >= 2) {
          overview.difficulty = 'Advanced';
        } else if (complexTechniques.length === 1) {
          overview.difficulty = 'Intermediate';
        } else {
          overview.difficulty = 'Beginner';
        }
      }
    }

  } catch (error) {
    console.error('Error parsing character overview:', error);
    // Return basic overview even if parsing fails
  }

  return overview;
}

// Training drills types
export interface TrainingDrill {
  name: string;
  category: 'fundamentals' | 'combos' | 'punishment' | 'movement' | 'heat' | 'character-specific' | 'anti-lab';
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  description: string;
  objectives: string[];
  setup: string;
  steps: string[];
  tips: string[];
  duration: string;
  repetitions?: number;
  moves?: TekkenMove[];
}

export interface TrainingProgram {
  character: string;
  focus: string;
  drills: TrainingDrill[];
  estimatedTime: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  description: string;
  lastUpdated: string;
}

export async function getTrainingDrills(
  character: string,
  focus?: 'fundamentals' | 'combos' | 'punishment' | 'movement' | 'heat' | 'pressure' | 'defense' | 'all'
): Promise<TrainingProgram> {
  const lowerChar = character.toLowerCase();
  characterSchema.parse(lowerChar);

  if (!isValidCharacter(lowerChar)) {
    const error = createCharacterNotFoundError(lowerChar);
    throw new Error(JSON.stringify(error, null, 2));
  }

  const normalizedFocus = focus || 'all';

  // Get character data for personalized drills
  const [overview, keyMoves] = await Promise.all([
    getCharacterOverview(lowerChar),
    getKeyMovesForDrills(lowerChar)
  ]);

  const drills = await generateTrainingDrills(lowerChar, normalizedFocus, overview, keyMoves);

  // Calculate estimated time and difficulty
  const totalTime = drills.reduce((acc, drill) => {
    const minutes = parseInt(drill.duration.split(' ')[0]) || 10;
    return acc + minutes;
  }, 0);

  const difficulty = determineProgramDifficulty(drills);

  return {
    character: lowerChar,
    focus: normalizedFocus,
    drills,
    estimatedTime: `${totalTime} minutes`,
    difficulty,
    description: generateProgramDescription(lowerChar, normalizedFocus, overview),
    lastUpdated: new Date().toISOString()
  };
}

async function getKeyMovesForDrills(character: string) {
  const lowerChar = character.toLowerCase();
  return {
    fastPokes: await searchMoves(lowerChar, { maxStartup: 12, minBlock: -10, limit: 5 }),
    launchers: await searchMoves(lowerChar, { minCounterHit: 20, limit: 5 }),
    heatEngagers: await searchMoves(lowerChar, { hasTag: "he", limit: 5 }),
    safeMoves: await searchMoves(lowerChar, { minBlock: -10, limit: 8 }),
    punishers: await searchMoves(lowerChar, { maxStartup: 15, limit: 10 })
  };
}

async function generateTrainingDrills(
  character: string,
  focus: string,
  overview: CharacterOverview,
  keyMoves: any
): Promise<TrainingDrill[]> {
  const lowerChar = character.toLowerCase();
  const drills: TrainingDrill[] = [];

  // Always include fundamentals
  if (focus === 'all' || focus === 'fundamentals') {
    drills.push(...getFundamentalDrills(lowerChar, keyMoves));
  }

  if (focus === 'all' || focus === 'movement') {
    drills.push(...getMovementDrills(lowerChar, overview));
  }

  if (focus === 'all' || focus === 'punishment') {
    drills.push(...getPunishmentDrills(lowerChar, keyMoves));
  }

  if (focus === 'all' || focus === 'heat') {
    drills.push(...getHeatDrills(lowerChar, keyMoves));
  }

  if (focus === 'all' || focus === 'combos') {
    drills.push(...getComboDrills(lowerChar, keyMoves));
  }

  if (focus === 'pressure') {
    drills.push(...getPressureDrills(lowerChar, keyMoves, overview));
  }

  if (focus === 'defense') {
    drills.push(...getDefenseDrills(lowerChar, keyMoves));
  }

  // Add character-specific drills
  drills.push(...getCharacterSpecificDrills(lowerChar, overview, keyMoves));

  return drills;
}

function getFundamentalDrills(character: string, keyMoves: any): TrainingDrill[] {
  const drills: TrainingDrill[] = [
    {
      name: "Jab Pressure Basics",
      category: "fundamentals",
      difficulty: "beginner",
      description: "Master basic jab pressure and frame advantage",
      objectives: [
        "Understand jab frame advantage",
        "Practice follow-up options",
        "Learn to maintain pressure"
      ],
      setup: "Practice mode, health set to infinite",
      steps: [
        "Perform jab (1) and observe frame advantage",
        "Practice jab → jab string",
        "Try jab → low poke mixup",
        "Practice jab → throw mixup"
      ],
      tips: [
        "Jabs are +1 on block for most characters",
        "Mix up timing to catch button presses",
        "Watch opponent's defensive habits"
      ],
      duration: "10 minutes",
      repetitions: 20,
      moves: keyMoves.fastPokes.filter((m: TekkenMove) => m.command === '1')
    },
    {
      name: "Whiff Punishment Training",
      category: "fundamentals",
      difficulty: "intermediate",
      description: "Practice punishing unsafe moves and whiffs",
      objectives: [
        "Recognize punishable moves",
        "Execute optimal punishers",
        "Improve reaction time"
      ],
      setup: "Set dummy to perform random unsafe moves",
      steps: [
        "Set dummy to random actions with unsafe moves",
        "Block and identify punishment windows",
        "Practice your optimal punishers",
        "Focus on consistent execution"
      ],
      tips: [
        "Learn the frame data of common moves",
        "Start with slower punishers, build speed",
        "Practice both standing and crouching punishers"
      ],
      duration: "15 minutes",
      moves: keyMoves.punishers.slice(0, 5)
    }
  ];

  return drills;
}

function getMovementDrills(character: string, overview: CharacterOverview): TrainingDrill[] {
  const drills: TrainingDrill[] = [
    {
      name: "Backdash Cancel Practice",
      category: "movement",
      difficulty: "intermediate",
      description: "Master backdash canceling for evasion and spacing",
      objectives: [
        "Execute clean backdash cancels",
        "Create space efficiently",
        "Set up whiff punishment"
      ],
      setup: "Practice mode, focus on movement",
      steps: [
        "Practice b,b,d/b motion repeatedly",
        "Focus on smooth, quick inputs",
        "Practice after different moves",
        "Try baiting and punishing attacks"
      ],
      tips: [
        "Timing is more important than speed",
        "Use to create whiff punishment opportunities",
        "Some characters have better backdashes than others"
      ],
      duration: "12 minutes",
      repetitions: 50
    },
    {
      name: "Korean Backdash",
      category: "movement",
      difficulty: "advanced",
      description: "Learn Korean backdash for advanced spacing",
      objectives: [
        "Execute Korean backdash consistently",
        "Cover more distance than regular backdash",
        "Integrate into neutral game"
      ],
      setup: "Practice mode, observe distance covered",
      steps: [
        "Input: b, d/b, b, d/b, b (repeat)",
        "Focus on smooth motion",
        "Compare distance to regular backdash",
        "Practice in neutral situations"
      ],
      tips: [
        "Start slow and build muscle memory",
        "Essential for high-level play",
        "Combine with sidestep for better evasion"
      ],
      duration: "20 minutes",
      repetitions: 100
    }
  ];

  // Add character-specific movement if applicable
  if (overview.keyTechniques?.some(tech => tech.toLowerCase().includes('wavedash'))) {
    drills.push({
      name: "Wavedash Practice",
      category: "movement",
      difficulty: "advanced",
      description: "Master wavedash movement for pressure and spacing",
      objectives: [
        "Execute consistent wavedashes",
        "Approach safely",
        "Set up mix-ups"
      ],
      setup: "Practice mode, focus on forward movement",
      steps: [
        "Input: f, n, d, d/f (crouch dash)",
        "Cancel into forward movement",
        "Practice varying speeds",
        "Integrate with attacks"
      ],
      tips: [
        "Essential for Mishima characters",
        "Use for safe approach",
        "Mix up timing to confuse opponents"
      ],
      duration: "15 minutes",
      repetitions: 50
    });
  }

  return drills;
}

function getPunishmentDrills(character: string, keyMoves: any): TrainingDrill[] {
  return [
    {
      name: "Frame Perfect Punishment",
      category: "punishment",
      difficulty: "intermediate",
      description: "Practice optimal punishers for different frame disadvantages",
      objectives: [
        "Know your fastest punishers",
        "Maximize damage on punishment",
        "Improve consistency"
      ],
      setup: "Set dummy to perform -10, -12, -14, -15 moves",
      steps: [
        "Practice i10 punisher on -10 moves",
        "Practice i12 punisher on -12 moves",
        "Practice i14+ launchers on -14+ moves",
        "Focus on not dropping punishments"
      ],
      tips: [
        "Know exact frame data",
        "Practice until it's automatic",
        "Different punishers for different ranges"
      ],
      duration: "15 minutes",
      moves: keyMoves.punishers
    }
  ];
}

function getHeatDrills(character: string, keyMoves: any): TrainingDrill[] {
  return [
    {
      name: "Heat Activation Practice",
      category: "heat",
      difficulty: "beginner",
      description: "Master heat activation and follow-ups",
      objectives: [
        "Activate heat consistently",
        "Know heat engager follow-ups",
        "Maximize heat mode damage"
      ],
      setup: "Practice mode with heat available",
      steps: [
        "Practice each heat engager",
        "Learn optimal heat combos",
        "Practice heat smash timing",
        "Work on heat dash mixups"
      ],
      tips: [
        "Heat changes move properties",
        "Some moves become plus on block",
        "Heat smash has wall splat properties"
      ],
      duration: "12 minutes",
      moves: keyMoves.heatEngagers
    }
  ];
}

function getComboDrills(character: string, keyMoves: any): TrainingDrill[] {
  return [
    {
      name: "Basic Launcher Combos",
      category: "combos",
      difficulty: "beginner",
      description: "Practice fundamental combos from main launchers",
      objectives: [
        "Execute basic combos consistently",
        "Learn damage scaling",
        "Practice wall carry"
      ],
      setup: "Practice mode, various stage positions",
      steps: [
        "Practice launcher → combo",
        "Focus on consistent timing",
        "Practice wall combos separately",
        "Work on side switch combos"
      ],
      tips: [
        "Start with easy combos, build complexity",
        "Damage scaling affects later hits",
        "Wall carry is often more valuable than raw damage"
      ],
      duration: "20 minutes",
      moves: keyMoves.launchers
    }
  ];
}

function getPressureDrills(character: string, keyMoves: any, overview: CharacterOverview): TrainingDrill[] {
  return [
    {
      name: "Frame Trap Sequences",
      category: "fundamentals",
      difficulty: "intermediate",
      description: "Practice frame traps and pressure maintenance",
      objectives: [
        "Understand frame advantage",
        "Create frame trap situations",
        "Maintain offensive pressure"
      ],
      setup: "Set dummy to mash buttons occasionally",
      steps: [
        "Use safe moves to stay plus",
        "Leave small gaps to catch button presses",
        "Practice throw mixups",
        "Work on stagger pressure"
      ],
      tips: [
        "Mix up timing to catch different defensive options",
        "Use character's plus frame moves",
        "Don't be too predictable with pressure"
      ],
      duration: "15 minutes",
      moves: keyMoves.safeMoves
    }
  ];
}

function getDefenseDrills(character: string, keyMoves: any): TrainingDrill[] {
  return [
    {
      name: "Defensive Options Practice",
      category: "fundamentals",
      difficulty: "intermediate",
      description: "Practice various defensive techniques",
      objectives: [
        "Learn when to block vs evade",
        "Practice breaking throws",
        "Improve defensive awareness"
      ],
      setup: "Set dummy to various attack patterns",
      steps: [
        "Practice blocking mix-ups",
        "Work on throw breaking",
        "Practice sidestep timing",
        "Work on low parry timing"
      ],
      tips: [
        "Don't always block - movement is key",
        "Learn common throw break scenarios",
        "Some attacks can be sidestepped on reaction"
      ],
      duration: "12 minutes"
    }
  ];
}

function getCharacterSpecificDrills(character: string, overview: CharacterOverview, keyMoves: any): TrainingDrill[] {
  const drills: TrainingDrill[] = [];

  // Add character-specific drills based on their key techniques
  if (character === 'law') {
    drills.push({
      name: "DSS Mixup Practice",
      category: "character-specific",
      difficulty: "intermediate",
      description: "Master Dragon Sign Stance transitions and mixups",
      objectives: [
        "Enter DSS consistently",
        "Mix up DSS options",
        "Create unpredictable offense"
      ],
      setup: "Practice mode, focus on stance transitions",
      steps: [
        "Practice d+1+2 to enter DSS",
        "Learn DSS.1, DSS.2, DSS.3, DSS.4 options",
        "Practice DSS mixups",
        "Work on DSS cancel timings"
      ],
      tips: [
        "DSS.2 is safe and plus",
        "DSS.4 is a launcher but risky",
        "Mix up timing to confuse opponents"
      ],
      duration: "15 minutes"
    });
  }

  if (character === 'steve') {
    drills.push({
      name: "Stance Transition Mastery",
      category: "character-specific",
      difficulty: "advanced",
      description: "Master Steve's unique stance system",
      objectives: [
        "Flow between stances smoothly",
        "Create stance mixups",
        "Maintain stance pressure"
      ],
      setup: "Practice mode, focus on stance flow",
      steps: [
        "Practice FLK, PAB, DCK transitions",
        "Learn stance-specific combos",
        "Practice stance cancels",
        "Work on stance pressure sequences"
      ],
      tips: [
        "Each stance has unique properties",
        "Stance transitions can avoid attacks",
        "Don't overuse stances - stay unpredictable"
      ],
      duration: "18 minutes"
    });
  }

  return drills;
}

function determineProgramDifficulty(drills: TrainingDrill[]): 'beginner' | 'intermediate' | 'advanced' {
  const difficulties = drills.map(d => d.difficulty);
  if (difficulties.includes('advanced')) return 'advanced';
  if (difficulties.includes('intermediate')) return 'intermediate';
  return 'beginner';
}

function generateProgramDescription(character: string, focus: string, overview: CharacterOverview): string {
  const archetype = overview.archetype || overview.playstyle || 'versatile';

  if (focus === 'all') {
    return `Comprehensive training program for ${character}, focusing on ${archetype} fundamentals and character-specific techniques.`;
  }

  return `Focused ${focus} training for ${character}, tailored for ${archetype} gameplay style.`;
}

