import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  listCharacters,
  getMovelist,
  getMove,
  searchMoves,
  getCharacterOverview,
  getTrainingDrills,
  compareCharacters,
  type TekkenMove,
  type SearchMovesFilters,
  type CharacterOverview,
  type TrainingProgram,
  type CharacterComparison
} from "./tekkenService.js";

// Helper function to format moves in a nice table format
function formatMovesTable(moves: TekkenMove[], title: string = "Moves"): string {
  if (moves.length === 0) return `No moves found.`;

  // Sort by strategic importance if available, then by block advantage
  const sortedMoves = moves.sort((a, b) => {
    if (a.strategicImportance !== undefined && b.strategicImportance !== undefined) {
      return b.strategicImportance - a.strategicImportance;
    }
    // Fallback to block advantage sorting
    const aBlock = parseFrameData(a.block);
    const bBlock = parseFrameData(b.block);
    if (aBlock !== null && bBlock !== null) {
      return bBlock - aBlock;
    }
    return 0;
  });

  let result = `### ${title}\n\n`;
  result += `| Command | Block Adv. | Startup | Strategic Importance | Notes Summary |\n`;
  result += `|---|---|---|---|---|\n`;

  sortedMoves.forEach(move => {
    const command = `\`${move.command}\``;
    const block = move.block || 'N/A';
    const startup = move.startup || 'N/A';
    const importance = move.strategicImportance !== undefined ? move.strategicImportance : 'N/A';

        // Create a descriptive summary of the notes
    let notesSummary = '';
    if (move.notes) {
      const notes = move.notes.toLowerCase();
      const block = parseFrameData(move.block);
      const hit = parseFrameData(move.hit);
      const ch = parseFrameData(move.counterHit);

      const isHitLauncher = isLauncher(move.hit);
      const isCHLauncher = isLauncher(move.counterHit);

      // Start building a descriptive sentence
      let description = [];

      // Safety description
      if (block !== null) {
        if (block > 0) {
          description.push('Plus on block');
        } else if (block >= -9) {
          description.push('Safe');
        } else if (block <= -15) {
          description.push('Launch punishable');
        }
      }

      // Speed description
      const startup = parseFrameData(move.startup);
      if (startup !== null) {
        if (startup <= 12) {
          description.push('fast');
        } else if (startup >= 20) {
          description.push('slow');
        }
      }

      // Hit level and properties
      if (move.hitLevel.includes('m')) {
        description.push('mid');
      } else if (move.hitLevel.includes('h')) {
        description.push('high');
      } else if (move.hitLevel.includes('l')) {
        description.push('low');
      }

      // Key properties
      if (notes.includes('heat engager')) description.push('Heat Engager');
      if (notes.includes('homing')) description.push('homing attack');
      if (notes.includes('power crush')) description.push('Power Crush');
      if (notes.includes('elbow')) description.push('elbow');
      if (notes.includes('knee')) description.push('knee');

      // What it does on hit
      if (isHitLauncher || isCHLauncher) {
        if (isCHLauncher && !isHitLauncher) {
          description.push('launches on counter hit');
        } else {
          description.push('launcher');
        }
      } else if (notes.includes('spike')) {
        description.push('causes spike');
      } else if (hit !== null && hit > 15) {
        description.push('gives significant advantage on hit');
      }

      // Special properties
      if (notes.includes('tornado')) description.push('Tornado');
      if (notes.includes('balcony break')) description.push('Balcony Break');
      if (notes.includes('wall break')) description.push('Wall Break');
      if (notes.includes('low crush')) description.push('low crushes');
      if (notes.includes('high crush')) description.push('high crushes');
      if (notes.includes('jail')) description.push('jails');
      if (notes.includes('guaranteed')) description.push('has guaranteed followups');

      // Stance transitions
      if (move.transitions && move.transitions.length > 0) {
        description.push(`transitions to ${move.transitions.join(', ')}`);
      } else if (notes.includes('transition')) {
        if (notes.includes('zen')) description.push('transitions to stance');
        else if (notes.includes('breaking step')) description.push('transitions to Breaking Step');
        else if (notes.includes('crouch')) description.push('transitions to crouch');
      }

      // Create final summary
      if (description.length > 0) {
        // Capitalize first word and create a proper sentence
        notesSummary = description.join(', ');
        notesSummary = notesSummary.charAt(0).toUpperCase() + notesSummary.slice(1);

        // Add period if it doesn't end with one
        if (!notesSummary.endsWith('.')) {
          notesSummary += '.';
        }

        // Limit length to keep table readable
        if (notesSummary.length > 80) {
          notesSummary = notesSummary.substring(0, 77) + '...';
        }
      } else {
        // Fallback to abbreviated move name if available
        notesSummary = move.name || 'Standard attack.';
      }
    } else {
      notesSummary = move.name || 'Standard attack.';
    }

    result += `| ${command} | ${block} | ${startup} | ${importance} | ${notesSummary} |\n`;
  });

  return result;
}

// Helper function to parse frame data
function parseFrameData(frameStr: string | undefined): number | null {
  if (!frameStr || frameStr === "") return null;

  const match = frameStr.match(/([+-]?\d+)/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

// Helper function to check if a move is a launcher
function isLauncher(frameStr: string | undefined): boolean {
  if (!frameStr) {
    return false;
  }
  if (frameStr === "") return false;

  // Check if it contains launch indicators
  if (frameStr.includes('a') && !frameStr.includes('(')) {
    return true;
  }

  // Extract numeric value for threshold check
  const match = frameStr.match(/\+(\d+)/);
  if (match) {
    const value = parseInt(match[1], 10);
    return value >= 20; // +20 or higher typically indicates launcher
  }

  return false;
}

// Function to detect if request should use table format
function shouldUseTableFormat(character: string, filters: any, context?: string): boolean {
  // Check if this looks like a "best moves" request
  const bestMovesIndicators = [
    'best moves', 'top moves', 'strongest moves', 'key moves',
    'most important', 'essential moves', 'core moves', 'main moves'
  ];

  // If it's a general search with no specific filters, likely wants best moves
  const hasMinimalFilters = Object.keys(filters).length <= 2; // character + maybe one filter

  // If asking for safe moves, launchers, or other categories that benefit from ranking
  const categoryRequests = ['safe', 'launcher', 'plus', 'heat engager', 'tornado'];
  const filterValues = Object.values(filters).join(' ').toLowerCase();
  const hasCategorialFilter = categoryRequests.some(category => filterValues.includes(category));

  return hasMinimalFilters || hasCategorialFilter;
}

// Structured output helper functions
interface SafetyAnalysis {
  category: "plus" | "very_safe" | "safe" | "jab_punishable" | "launch_punishable" | "very_unsafe" | "unknown";
  numeric: number | null;
  explanation: string;
}

interface SpeedAnalysis {
  category: "very_fast" | "fast" | "medium" | "slow" | "very_slow" | "unknown";
  numeric: number | null;
  usage: string[];
}

interface MoveAnalysis {
  move: {
    command: string;
    name?: string;
    frameData: {
      startup?: string;
      block?: string;
      hit?: string;
      counterHit?: string;
    };
    properties: {
      hitLevel: string;
      damage: string;
      tags?: Record<string, string>;
      notes?: string;
    };
  };
  analysis: {
    safety: SafetyAnalysis;
    speed: SpeedAnalysis;
    reward: string;
    usage: string[];
    strategicImportance?: number;
    whyImportant?: string;
    bestFor?: string[];
  };
}

function analyzeSafety(move: TekkenMove): SafetyAnalysis {
  const block = parseFrameData(move.block);

  if (block === null) {
    return {
      category: "unknown",
      numeric: null,
      explanation: "Block advantage not available"
    };
  }

  if (block > 0) {
    return {
      category: "plus",
      numeric: block,
      explanation: `Plus on block (+${block}), your turn continues`
    };
  } else if (block >= -4) {
    return {
      category: "very_safe",
      numeric: block,
      explanation: "Very safe, cannot be punished by most attacks"
    };
  } else if (block >= -9) {
    return {
      category: "safe",
      numeric: block,
      explanation: "Safe, cannot be punished by standing jabs"
    };
  } else if (block >= -12) {
    return {
      category: "jab_punishable",
      numeric: block,
      explanation: "Jab punishable, opponent can counter with fast attacks"
    };
  } else if (block >= -15) {
    return {
      category: "launch_punishable",
      numeric: block,
      explanation: "Launch punishable, opponent can use launchers"
    };
  } else {
    return {
      category: "very_unsafe",
      numeric: block,
      explanation: "Very unsafe, easily punishable"
    };
  }
}

function analyzeSpeed(move: TekkenMove): SpeedAnalysis {
  const startup = parseFrameData(move.startup);

  if (startup === null) {
    return {
      category: "unknown",
      numeric: null,
      usage: []
    };
  }

  let category: SpeedAnalysis["category"];
  let usage: string[];

  if (startup <= 10) {
    category = "very_fast";
    usage = ["punisher", "jab", "poke"];
  } else if (startup <= 13) {
    category = "fast";
    usage = ["poke", "pressure", "punisher"];
  } else if (startup <= 16) {
    category = "medium";
    usage = ["pressure", "launcher", "poke"];
  } else if (startup <= 20) {
    category = "slow";
    usage = ["launcher", "whiff_punisher"];
  } else {
    category = "very_slow";
    usage = ["whiff_punisher"];
  }

  return { category, numeric: startup, usage };
}

function analyzeReward(move: TekkenMove): string {
  if (isLauncher(move.hit) || isLauncher(move.counterHit)) {
    return "launcher";
  }

  const hit = parseFrameData(move.hit);
  if (hit !== null) {
    if (hit >= 20) return "launcher";
    if (hit >= 15) return "high_advantage";
    if (hit >= 10) return "medium_advantage";
    if (hit >= 5) return "good_advantage";
    if (hit > 0) return "plus_frames";
  }

  return "low_reward";
}

function suggestUsage(move: TekkenMove): string[] {
  const usage: string[] = [];
  const block = parseFrameData(move.block);
  const startup = parseFrameData(move.startup);
  const hit = parseFrameData(move.hit);

  // Safety + speed combinations
  if (block !== null && block >= -9 && startup !== null && startup <= 13) {
    usage.push("neutral_poke");
  }

  if (isLauncher(move.counterHit)) {
    usage.push("whiff_punisher");
  }

  if (startup !== null && startup <= 10) {
    usage.push("punisher");
  }

  if (move.tags?.he || move.notes?.toLowerCase().includes("heat engager")) {
    usage.push("heat_engager");
  }

  if (block !== null && block > 0) {
    usage.push("pressure_tool");
  }

  if (move.hitLevel.includes("l")) {
    usage.push("mixup_tool");
  }

  if (move.hitLevel.includes("h") && startup !== null && startup <= 10) {
    usage.push("high_crush_check");
  }

  if (usage.length === 0) {
    usage.push("general_attack");
  }

  return [...new Set(usage)]; // Remove duplicates
}

function createMoveAnalysis(move: TekkenMove): MoveAnalysis {
  const safety = analyzeSafety(move);
  const speed = analyzeSpeed(move);
  const reward = analyzeReward(move);
  const usage = suggestUsage(move);

  // Determine why it's important
  let whyImportant: string | undefined;
  if (move.strategicImportance && move.strategicImportance >= 80) {
    if (safety.category === "very_safe" && speed.category === "fast") {
      whyImportant = "Fast, safe mid poke - essential neutral tool";
    } else if (move.tags?.he) {
      whyImportant = "Heat engager - crucial for heat activation";
    } else if (isLauncher(move.counterHit)) {
      whyImportant = "Counter-hit launcher - devastating punisher";
    } else if (safety.category === "plus") {
      whyImportant = "Plus on block - powerful pressure tool";
    }
  }

  // Best for scenarios
  const bestFor: string[] = [];
  if (safety.category === "safe" || safety.category === "very_safe") {
    bestFor.push("Neutral game");
  }
  if (safety.category === "plus") {
    bestFor.push("Pressure");
    bestFor.push("Frame traps");
  }
  if (isLauncher(move.counterHit)) {
    bestFor.push("Whiff punishment");
  }
  if (speed.category === "very_fast" || speed.category === "fast") {
    bestFor.push("Pokes");
  }

  return {
    move: {
      command: move.command,
      name: move.name,
      frameData: {
        startup: move.startup,
        block: move.block,
        hit: move.hit,
        counterHit: move.counterHit
      },
      properties: {
        hitLevel: move.hitLevel,
        damage: move.damage,
        tags: move.tags,
        notes: move.notes
      }
    },
    analysis: {
      safety,
      speed,
      reward,
      usage,
      strategicImportance: move.strategicImportance,
      whyImportant,
      bestFor: bestFor.length > 0 ? bestFor : undefined
    }
  };
}

export async function createServer() {
  const server = new Server({
    name: "tekken‑docs",
    version: "0.1.0"
  });

  // Handle list resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const characters = await listCharacters();
    return {
      resources: [
        {
          uri: "tekken://characters",
          name: "All Tekken 8 Characters",
          description: "Complete list of available characters",
          mimeType: "text/plain"
        },
        ...characters.map(char => ({
          uri: `tekken://characters/${char}/movelist`,
          name: `${char} Movelist`,
          description: `Complete movelist for ${char}`,
          mimeType: "application/json"
        }))
      ]
    };
  });

  // Handle read resource
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === "tekken://characters") {
      const characters = await listCharacters();
      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: characters.join('\n')
          }
        ]
      };
    }

    const movelistMatch = uri.match(/^tekken:\/\/characters\/([^\/]+)\/movelist$/);
    if (movelistMatch) {
      const character = movelistMatch[1];
      const movelist = await getMovelist(character);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(movelist, null, 2)
          }
        ]
      };
    }

    throw new Error(`Resource not found: ${uri}`);
  });

  // Handle list tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "listCharacters",
          description: `Return array of available Tekken 8 characters.

🎯 WHEN TO USE:
• Starting a conversation about Tekken 8
• User asks "who can I play?" or "what characters are available?"
• Recovering from a CHARACTER_NOT_FOUND error
• Validating character names before other operations

📋 RETURNS:
Array of all playable Tekken 8 character names (lowercase, URL-friendly format)

🔗 COMBINE WITH:
• After listing, use getCharacterOverview() to learn about specific characters
• Use compareCharacters() to help choose between options

💡 EXAMPLES:
Q: "What characters are in Tekken 8?"
A: listCharacters() → shows all 33 characters

Q: "Can I play Heihachi?"
A: listCharacters() → check if "heihachi" is in list`,
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        },
        {
          name: "getMove",
          description: `Retrieve detailed frame data for a specific move by exact command.

🎯 WHEN TO USE:
• Looking up a specific move the user mentioned (e.g., "what's Law's d/f+2?")
• Getting exact frame data for a known move
• Verifying move properties after seeing it in a match
• Need precise data for one specific move

⚠️ NOTE: Requires EXACT command notation. For finding moves by properties, use searchMoves() instead.

📋 RETURNS:
Complete frame data including startup, block advantage, hit advantage, counter-hit, damage, notes, and tags

🔗 COMBINE WITH:
• Use searchMoves() first if you don't know the exact command
• Use getKeyMoves() to discover important move commands
• Follow up with getTrainingDrills() to practice the move

💡 EXAMPLES:
Q: "What are the frames on Law's Dragon Hammer?"
A: searchMoves("law", { hasTag: "launcher" }) → find command → getMove("law", "d+2,3")

Q: "Is Jin's f+4 safe?"
A: getMove("jin", "f+4") → check block advantage`,
          inputSchema: {
            type: "object",
            properties: {
              character: {
                type: "string",
                description: "Character name (e.g., 'law', 'jin', 'kazuya'). Case-insensitive."
              },
              command: {
                type: "string",
                description: "Exact move command notation (e.g., 'd/f+2', 'b+4', '1,2,3'). Must match exactly."
              }
            },
            required: ["character", "command"]
          }
        },
        {
          name: "searchMoves",
          description: `Search and filter moves by frame data properties. The most versatile tool for finding moves.

🎯 WHEN TO USE:
• Finding safe moves for neutral game: { minBlock: -9 }
• Finding punishers: { maxStartup: 10 } for i10, { maxStartup: 12 } for i12
• Finding launchers: { minCounterHit: 20 } or { hasTag: "chl" }
• Finding fast pokes: { maxStartup: 12, minBlock: -9 }
• Finding pressure tools: { minHit: 1, maxStartup: 13 } (plus frame pokes)
• Finding specific move types: { hasTag: "he" } for heat engagers

📋 COMMON PATTERNS:
• Best neutral pokes: { hitLevel: "m", minBlock: -9, maxStartup: 13 }
• Fast launchers: { minCounterHit: 20, maxStartup: 16 }
• Plus frame moves: { minBlock: 0 }
• Safe pressure: { minBlock: -9, minHit: 5 }
• Heat engagers: { hasTag: "he" }
• Low pokes: { hitLevel: "l", minBlock: -12 }

🔗 COMBINE WITH:
• After getCharacterOverview() to understand playstyle context
• Before getTrainingDrills() to identify what to practice
• With getKeyMoves() to see curated vs. filtered results

⚠️ PRO TIPS:
• -9 or better = safe (can't be punished by standing jabs)
• i10-i12 = fast pokes/punishers
• i13-i15 = launchers/big damage
• minCounterHit: 20 = counter-hit launchers
• Combine filters for precise results

💡 EXAMPLES:
Q: "What are Law's safe mids?"
A: searchMoves("law", { hitLevel: "m", minBlock: -9 })

Q: "Show me Jin's fastest punishers"
A: searchMoves("jin", { maxStartup: 12, limit: 5 })

Q: "What moves can Law use for pressure?"
A: searchMoves("law", { minBlock: 0, maxStartup: 15 })`,
          inputSchema: {
            type: "object",
            properties: {
              character: {
                type: "string",
                description: "Character name (e.g., 'law', 'jin', 'kazuya')"
              },
              hitLevel: {
                type: "string",
                enum: ["h", "m", "l", "s"],
                description: `Hit level filter:
• 'h' = high (can be ducked, common for jabs)
• 'm' = mid (must be blocked, best for neutral)
• 'l' = low (must be blocked crouching, for mixups)
• 's' = special (throws, unblockables)

💡 TIP: Mids are safest for neutral game as they can't be ducked`
              },
              minDamage: {
                type: "number",
                description: "Minimum damage value (e.g., 20 for heavy hitters)"
              },
              maxStartup: {
                type: "number",
                description: `Maximum startup frames (lower = faster):
• 10 = i10 punisher (jab speed)
• 12 = i12 punisher (fast mids)
• 13-15 = launchers
• 16-20 = slower, riskier moves

EXAMPLE: maxStartup: 10 finds all i10 moves`
              },
              minBlock: {
                type: "number",
                description: `Minimum block advantage (for safe moves):
• -9 or better = Safe (standard threshold)
• 0 or better = Plus on block (your turn)
• +3 to +5 = Frame trap territory

EXAMPLE: minBlock: -9 finds all safe moves`
              },
              maxBlock: {
                type: "number",
                description: "Maximum block advantage (for finding unsafe moves, e.g., -15 for launch punishable)"
              },
              minHit: {
                type: "number",
                description: `Minimum hit advantage (for advantage on hit):
• 1+ = Plus on hit
• 5+ = Significant advantage
• 10+ = Combo opportunity
• 15+ = Usually a launcher

EXAMPLE: minHit: 5 finds moves with good hit advantage`
              },
              minCounterHit: {
                type: "number",
                description: `Minimum counter-hit advantage:
• 20+ = Counter-hit launcher (most important)
• 15+ = Combo starter
• 10+ = Good advantage

EXAMPLE: minCounterHit: 20 finds all CH launchers`
              },
              hasTag: {
                type: "string",
                description: `Filter by special properties:
• "he" = Heat Engagers (activate heat mode)
• "heat" = Heat moves (H. commands + heat tagged moves)
• "chl" or "launcher" = Counter-hit launchers
• "tornado" = Tornado (screw) moves for combos
• "safe" = Safe moves (-9 or better on block)
• "pc" = Power Crush
• "charge" or "hold" = Charge/hold moves

EXAMPLE: hasTag: "he" finds all heat engagers`
              },
              limit: {
                type: "number",
                description: "Limit number of results (useful for 'top 5' queries). Default: return all matching moves"
              },
              format: {
                type: "string",
                enum: ["structured", "formatted", "both"],
                description: `Output format (default: "formatted"):
• "structured" = Machine-readable JSON with analysis, metadata, recommendations
• "formatted" = Human-readable text/table format
• "both" = Returns both structured and formatted

💡 TIP: Agents should use "structured" for programmatic reasoning`
              }
            },
            required: ["character"]
          }
        },
        {
          name: "getCharacterOverview",
          description: `Get comprehensive character information including playstyle, strengths, weaknesses, and key techniques.

🎯 WHEN TO USE:
• Starting to learn a new character
• User asks "how does X play?" or "is X good for beginners?"
• Need to understand character archetype before suggesting moves
• Comparing character philosophies and gameplans
• First step in any "learn character" workflow

📋 RETURNS:
• Bio (name, nationality, fighting style)
• Playstyle & archetype (rushdown, zoner, grappler, etc.)
• Difficulty rating (beginner, intermediate, advanced)
• Strengths (what the character excels at)
• Weaknesses (what the character struggles with)
• Key techniques (signature moves and strategies)

🔗 COMBINE WITH:
• Follow with getKeyMoves() to see specific important moves
• Follow with searchMoves() to find moves matching their strengths
• Follow with getTrainingDrills() for practice plan
• Use before compareCharacters() to understand differences

⚠️ DATA SOURCE: Wavu Wiki (community-maintained, may lag behind patches)

💡 EXAMPLES:
Q: "Tell me about Law"
A: getCharacterOverview("law") → Learn he's rushdown with DSS stance

Q: "Is Jin good for beginners?"
A: getCharacterOverview("jin") → Check difficulty rating

Q: "What are Paul's weaknesses?"
A: getCharacterOverview("paul") → Read weaknesses section

TYPICAL WORKFLOW:
1. getCharacterOverview("law") ← Start here
2. getKeyMoves("law") ← See important moves
3. getTrainingDrills("law", "fundamentals") ← Practice plan`,
          inputSchema: {
            type: "object",
            properties: {
              character: {
                type: "string",
                description: "Character name (e.g., 'law', 'jin', 'kazuya'). Case-insensitive."
              }
            },
            required: ["character"]
          }
        },
        {
          name: "getKeyMoves",
          description: `Get curated list of essential moves every player should know for a character.

🎯 WHEN TO USE:
• User asks "what moves should I learn first?"
• After getCharacterOverview() to see concrete moves
• Quick reference for character's most important tools
• Building a "starter kit" for new character players
• Want expert-curated moves instead of manual filtering

📋 RETURNS:
Categorized essential moves:
• 🚀 Best Launchers (CH +20 or better)
• 👊 Fast Pokes (i12 or faster, safe on block)
• 🛡️ Safe Moves (-9 or better on block)
• 🔥 Heat Engagers (activate heat mode)

Each move includes command, name, frame data, and usage notes

🔗 COMBINE WITH:
• After getCharacterOverview() for context
• Before getTrainingDrills() to know what to practice
• Compare with searchMoves() for more options

⚠️ VS searchMoves():
• getKeyMoves() = Curated essentials (10-20 moves)
• searchMoves() = Custom filtered results (any criteria)

💡 EXAMPLES:
Q: "What are Law's most important moves?"
A: getKeyMoves("law") → See his top launchers, pokes, heat engagers

Q: "I just picked up Jin, what should I learn?"
A: getKeyMoves("jin") → Get starter movelist

Q: "What are the must-know moves for Bryan?"
A: getKeyMoves("bryan") → Essential toolkit

TYPICAL WORKFLOW:
1. getCharacterOverview("law") ← Understand playstyle
2. getKeyMoves("law") ← See essential moves ← YOU ARE HERE
3. getTrainingDrills("law", "fundamentals") ← Practice them`,
          inputSchema: {
            type: "object",
            properties: {
              character: {
                type: "string",
                description: "Character name to get key moves for (e.g., 'law', 'jin', 'kazuya')"
              }
            },
            required: ["character"]
          }
        },
        {
          name: "getTrainingDrills",
          description: `Generate structured training programs with specific drills and practice routines.

🎯 WHEN TO USE:
• User asks "how do I practice?" or "how do I get better at X?"
• After showing character overview and key moves
• User wants concrete practice plan
• Need step-by-step training instructions
• Building a learning roadmap

📋 RETURNS:
Complete training program with:
• Estimated time commitment
• Difficulty assessment
• Multiple focused drills with:
  - Objectives (what you'll learn)
  - Setup instructions
  - Step-by-step process
  - Pro tips
  - Duration & repetitions
  - Specific moves to practice

🎯 FOCUS AREAS:
• "fundamentals" - Core gameplan, pokes, spacing (START HERE)
• "combos" - Launcher combos, wall combos, optimization
• "punishment" - Punisher drills, frame-perfect execution
• "movement" - Backdash, Korean backdash, wavedash (if applicable)
• "heat" - Heat activation, heat mode strategies
• "pressure" - Frame traps, plus frames, offense
• "defense" - Blocking, throw breaks, defensive options
• "all" - Comprehensive program covering everything

🔗 COMBINE WITH:
• After getCharacterOverview() and getKeyMoves()
• Use focus area matching character's playstyle
• Revisit with different focus areas as you improve

⚠️ PRO TIPS:
• Start with "fundamentals" for new characters
• Focus on one area at a time for faster improvement
• "all" provides complete coverage but takes longer
• Practice drills in order (beginner → advanced)

💡 EXAMPLES:
Q: "How do I practice Law?"
A: getTrainingDrills("law", "fundamentals") → 30-min fundamental program

Q: "I keep dropping combos with Jin"
A: getTrainingDrills("jin", "combos") → Combo-specific drills

Q: "How do I improve my punishment?"
A: getTrainingDrills("kazuya", "punishment") → Punisher training

Q: "Give me a complete Law training plan"
A: getTrainingDrills("law", "all") → Full program

TYPICAL WORKFLOW:
1. getCharacterOverview("law") ← Understand character
2. getKeyMoves("law") ← Know important moves
3. getTrainingDrills("law", "fundamentals") ← Practice! ← YOU ARE HERE`,
          inputSchema: {
            type: "object",
            properties: {
              character: {
                type: "string",
                description: "Character name to generate training drills for (e.g., 'law', 'jin', 'kazuya')"
              },
              focus: {
                type: "string",
                enum: ["fundamentals", "combos", "punishment", "movement", "heat", "pressure", "defense", "all"],
                description: `Training focus area:
• "fundamentals" = Pokes, spacing, gameplan (best for beginners)
• "combos" = Launchers, wall combos, damage optimization
• "punishment" = Frame-perfect punishers, whiff punishment
• "movement" = Backdash, Korean backdash, wavedash
• "heat" = Heat engagers, heat mode strategies
• "pressure" = Frame traps, plus frames, offensive tools
• "defense" = Blocking mixups, throw breaks, defensive awareness
• "all" = Comprehensive program (longer time commitment)

Default: "all" if not specified`
              }
            },
            required: ["character"]
          }
        },
        {
          name: "compareCharacters",
          description: `Compare two characters across multiple dimensions (speed, safety, damage, playstyle).

🎯 WHEN TO USE:
• Deciding which character to learn
• User asks "should I play Law or Jin?"
• Understanding character matchups
• Identifying playstyle differences
• Evaluating transition difficulty between characters

📊 COMPARES:
• Speed (startup frames, fastest moves, average speed)
• Safety (safe move count, average block advantage)
• Damage (average damage, max damage)
• Playstyle (archetype similarity, difficulty, key techniques)

🔗 COMBINE WITH:
• Use after getCharacterOverview() for both characters to understand context
• Can follow with getKeyMoves() for character-specific move comparisons
• Use to answer "which character?" questions with data

💡 EXAMPLES:
Q: "Should I learn Law or Jin?"
A: compareCharacters("law", "jin") → Quantitative comparison

Q: "How similar are King and Armor King?"
A: compareCharacters("king", "armor-king") → Playstyle similarity score

Q: "Which is faster, Kazuya or Jin?"
A: compareCharacters("kazuya", "jin") → Speed comparison details

📋 RETURNS:
Complete comparison with:
• Winner for each category (speed, safety, damage)
• Detailed metrics and differences
• Playstyle similarity score (0-1)
• Recommendations for each character
• Transition difficulty rating`,
          inputSchema: {
            type: "object",
            properties: {
              character1: {
                type: "string",
                description: "First character to compare (e.g., 'law', 'jin')"
              },
              character2: {
                type: "string",
                description: "Second character to compare (e.g., 'jin', 'kazuya')"
              }
            },
            required: ["character1", "character2"]
          }
        },
        {
          name: "getCapabilities",
          description: `Understand what this Tekken MCP server can do and discover optimal workflows.

🎯 WHEN TO USE:
• Starting a conversation (discover what's possible)
• User asks "what can you help me with?"
• Planning a complex multi-step task
• Unsure which tool to use next
• Want to understand data sources and limitations

📋 RETURNS:
Comprehensive server capabilities including:
• Available data sources (TekkenDocs, Wavu Wiki)
• Tool categories and their purposes
• Common workflows with step-by-step guides
• Best practices for agents and users
• Known limitations and update frequencies
• Future planned features

🔗 USE THIS TO:
• Plan optimal tool call sequences
• Understand when to use which tool
• Learn common usage patterns
• Discover relationships between tools
• Set user expectations correctly

⚠️ BEST PRACTICE:
Call this once at the start of complex tasks to understand the full toolkit

💡 EXAMPLES:
Q: "What can this server do?"
A: getCapabilities() → Full capability overview

Q: "How do I learn a new character?"
A: getCapabilities() → See "Learn new character" workflow

Q: "What's the best way to prepare for a matchup?"
A: getCapabilities() → See "Prepare for matchup" workflow

AGENT TIP:
This tool helps you discover optimal workflows and avoid unnecessary tool calls`,
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        }
      ]
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "listCharacters") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(await listCharacters())
          }
        ]
      };
    }

    if (name === "getMove") {
      const { character, command } = args as { character: string; command: string };
      const move = await getMove(character, command);
      if (!move) {
        throw new Error(`Move ${command} not found for ${character}`);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(move, null, 2)
          }
        ]
      };
    }

    if (name === "searchMoves") {
      const { character, format = "formatted", ...filters } = args as any;
      const moves = await searchMoves(character, filters);

      // Build structured output
      const moveAnalyses = moves.map(move => createMoveAnalysis(move));

      // Calculate summary statistics
      const startups = moves.map(m => parseFrameData(m.startup)).filter(s => s !== null) as number[];
      const blocks = moves.map(m => parseFrameData(m.block)).filter(b => b !== null) as number[];
      const damages = moves.map(m => parseInt(m.damage.match(/\d+/)?.[0] || "0"));

      const structured = {
        metadata: {
          character,
          query: filters,
          timestamp: new Date().toISOString(),
          resultCount: moves.length,
          dataSource: "TekkenDocs API",
          confidence: 1.0,
          queryType: "filtered_search"
        },
        results: moveAnalyses,
        summary: {
          fastestMove: moves.length > 0 && startups.length > 0
            ? { command: moves[startups.indexOf(Math.min(...startups))].command, startup: Math.min(...startups) }
            : undefined,
          safestMove: moves.length > 0 && blocks.length > 0
            ? { command: moves[blocks.indexOf(Math.max(...blocks))].command, block: Math.max(...blocks) }
            : undefined,
          highestDamage: moves.length > 0 && damages.length > 0
            ? { command: moves[damages.indexOf(Math.max(...damages))].command, damage: Math.max(...damages) }
            : undefined,
          statistics: {
            totalResults: moves.length,
            averageStartup: startups.length > 0 ? startups.reduce((a, b) => a + b, 0) / startups.length : undefined,
            averageBlock: blocks.length > 0 ? blocks.reduce((a, b) => a + b, 0) / blocks.length : undefined,
            safeMoveCount: blocks.filter(b => b >= -9).length,
            plusOnBlockCount: blocks.filter(b => b > 0).length
          }
        },
        recommendations: {
          nextSteps: [
            `Use getTrainingDrills('${character}', 'fundamentals') to practice these moves`,
            `See getKeyMoves('${character}') for curated essential moves`
          ],
          relatedQueries: [
            {
              tool: "getKeyMoves",
              params: { character },
              reason: "See expert-curated moves instead of filtered results",
              priority: "high"
            },
            {
              tool: "getTrainingDrills",
              params: { character, focus: "fundamentals" },
              reason: "Practice these moves",
              priority: "medium"
            }
          ]
        }
      };

      // Build formatted output
      const useTableFormat = shouldUseTableFormat(character, filters);
      let formatted: string;

      if (useTableFormat && moves.length > 0) {
        const title = `${character.charAt(0).toUpperCase() + character.slice(1)}'s Best Moves`;
        formatted = formatMovesTable(moves, title);
      } else {
        const summary = `Found ${moves.length} moves for ${character}` +
          (filters.hitLevel ? ` (${filters.hitLevel} attacks)` : '') +
          (filters.maxStartup ? ` (≤${filters.maxStartup}f startup)` : '') +
          (filters.minBlock ? ` (≥${filters.minBlock} on block)` : '') +
          (filters.hasTag ? ` (${filters.hasTag} moves)` : '');

        const movesList = moves.map(move =>
          `${move.command} - ${move.name || 'Unnamed'}\n` +
          `  Hit: ${move.hitLevel} | Damage: ${move.damage} | Startup: ${move.startup || 'N/A'}\n` +
          `  Block: ${move.block} | Hit: ${move.hit} | CH: ${move.counterHit}\n` +
          (move.notes ? `  Notes: ${move.notes}\n` : '')
        ).join('\n');

        formatted = `${summary}\n\n${movesList}`;
      }

      // Return based on format preference
      if (format === "structured") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(structured, null, 2)
            }
          ]
        };
      } else if (format === "formatted") {
        return {
          content: [
            {
              type: "text",
              text: formatted
            }
          ]
        };
      } else { // both
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ structured, formatted }, null, 2)
            }
          ]
        };
      }
    }

    if (name === "getCharacterOverview") {
      const { character } = args as { character: string };
      const overview = await getCharacterOverview(character);

      let resultText = `Character Overview: ${overview.name}\n\n`;

      if (overview.bio) {
        resultText += `Bio:\n`;
        if (overview.bio.fullName) resultText += `  Full Name: ${overview.bio.fullName}\n`;
        if (overview.bio.nationality) resultText += `  Nationality: ${overview.bio.nationality}\n`;
        if (overview.bio.fightingStyle) resultText += `  Fighting Style: ${overview.bio.fightingStyle}\n`;
        if (overview.bio.description) resultText += `  Description: ${overview.bio.description}\n`;
        resultText += '\n';
      }

      if (overview.playstyle) {
        resultText += `Playstyle: ${overview.playstyle}\n\n`;
      }

      if (overview.archetype) {
        resultText += `Archetype: ${overview.archetype}\n\n`;
      }

      if (overview.difficulty) {
        resultText += `Difficulty: ${overview.difficulty}\n\n`;
      }

      if (overview.strengths && overview.strengths.length > 0) {
        resultText += `Strengths:\n`;
        overview.strengths.forEach(strength => {
          resultText += `  • ${strength}\n`;
        });
        resultText += '\n';
      }

      if (overview.weaknesses && overview.weaknesses.length > 0) {
        resultText += `Weaknesses:\n`;
        overview.weaknesses.forEach(weakness => {
          resultText += `  • ${weakness}\n`;
        });
        resultText += '\n';
      }

      if (overview.keyTechniques && overview.keyTechniques.length > 0) {
        resultText += `Key Techniques:\n`;
        overview.keyTechniques.forEach(technique => {
          resultText += `  • ${technique}\n`;
        });
        resultText += '\n';
      }

      resultText += `Source: Wavu Wiki\n`;
      if (overview.lastUpdated) {
        resultText += `Last Updated: ${new Date(overview.lastUpdated).toLocaleDateString()}\n`;
      }

      return {
        content: [
          {
            type: "text",
            text: resultText
          }
        ]
      };
    }

    if (name === "getKeyMoves") {
      const { character } = args as { character: string };

      // Get key moves for the character
      const keyMoves = [
        // Best launchers
        await searchMoves(character, { minCounterHit: 20, limit: 5 }),
        // Fast pokes
        await searchMoves(character, { maxStartup: 12, minBlock: -9, limit: 5 }),
        // Safe moves
        await searchMoves(character, { minBlock: -9, limit: 5 }),
        // Heat engagers
        await searchMoves(character, { hasTag: "he", limit: 5 }),
      ];

      let resultText = `Key Moves for ${character}:\n\n`;

      if (keyMoves[0].length > 0) {
        resultText += `🚀 Best Launchers (CH +20 or better):\n`;
        keyMoves[0].forEach(move => {
          resultText += `  • ${move.command} - ${move.name || 'Unnamed'} (CH: ${move.counterHit})\n`;
        });
        resultText += '\n';
      }

      if (keyMoves[1].length > 0) {
        resultText += `👊 Fast Pokes (i12 or faster, safe):\n`;
        keyMoves[1].forEach(move => {
          resultText += `  • ${move.command} - ${move.name || 'Unnamed'} (i${move.startup}, ${move.block} ob)\n`;
        });
        resultText += '\n';
      }

      if (keyMoves[2].length > 0) {
        resultText += `🛡️ Safe Moves (-9 or better on block):\n`;
        keyMoves[2].forEach(move => {
          resultText += `  • ${move.command} - ${move.name || 'Unnamed'} (${move.block} ob)\n`;
        });
        resultText += '\n';
      }

      if (keyMoves[3].length > 0) {
        resultText += `🔥 Heat Engagers:\n`;
        keyMoves[3].forEach(move => {
          resultText += `  • ${move.command} - ${move.name || 'Unnamed'} (${move.block} ob)\n`;
        });
        resultText += '\n';
      }

      return {
        content: [
          {
            type: "text",
            text: resultText
          }
        ]
      };
    }

        if (name === "getTrainingDrills") {
      const { character, focus } = args as { character: string; focus?: string };

      const program = await getTrainingDrills(character, focus as any);

      let resultText = `🥋 Training Program: ${program.character.toUpperCase()}\n\n`;

      // Program overview
      resultText += `📋 Program Overview:\n`;
      resultText += `  Focus: ${program.focus}\n`;
      resultText += `  Difficulty: ${program.difficulty}\n`;
      resultText += `  Estimated Time: ${program.estimatedTime}\n`;
      resultText += `  Description: ${program.description}\n\n`;

      // Training drills
      resultText += `🎯 Training Drills:\n\n`;

      program.drills.forEach((drill, index) => {
        const categoryEmoji = {
          'fundamentals': '🥊',
          'combos': '⚡',
          'punishment': '🛡️',
          'movement': '🏃',
          'heat': '🔥',
          'character-specific': '⭐',
          'anti-lab': '🧠'
        };

        resultText += `${index + 1}. ${categoryEmoji[drill.category] || '•'} ${drill.name} (${drill.difficulty})\n`;
        resultText += `   ${drill.description}\n\n`;

        resultText += `   📝 Objectives:\n`;
        drill.objectives.forEach(obj => {
          resultText += `     • ${obj}\n`;
        });

        resultText += `\n   🎮 Setup: ${drill.setup}\n\n`;

        resultText += `   📋 Steps:\n`;
        drill.steps.forEach((step, stepIndex) => {
          resultText += `     ${stepIndex + 1}. ${step}\n`;
        });

        if (drill.tips.length > 0) {
          resultText += `\n   💡 Tips:\n`;
          drill.tips.forEach(tip => {
            resultText += `     • ${tip}\n`;
          });
        }

        resultText += `\n   ⏱️ Duration: ${drill.duration}`;
        if (drill.repetitions) {
          resultText += ` | Repetitions: ${drill.repetitions}`;
        }

        if (drill.moves && drill.moves.length > 0) {
          resultText += `\n   🎯 Key Moves: `;
          resultText += drill.moves.slice(0, 3).map(m => m.command).join(', ');
          if (drill.moves.length > 3) {
            resultText += ` (+${drill.moves.length - 3} more)`;
          }
        }

        resultText += `\n\n`;
      });

      resultText += `Last Updated: ${new Date(program.lastUpdated).toLocaleDateString()}\n`;

      return {
        content: [
          {
            type: "text",
            text: resultText
          }
        ]
      };
    }

    if (name === "compareCharacters") {
      const { character1, character2 } = args as { character1: string; character2: string };
      const comparison = await compareCharacters(character1, character2);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(comparison, null, 2)
          }
        ]
      };
    }

    if (name === "getCapabilities") {
      const capabilities = {
        server: {
          name: "Tekken 8 MCP Server",
          version: "0.1.0",
          purpose: "Provide frame data, character information, and strategic analysis for Tekken 8"
        },
        dataSources: {
          frameData: {
            source: "TekkenDocs API",
            url: "https://tekkendocs.com",
            coverage: "All Tekken 8 characters (33 characters)",
            updateFrequency: "Real-time",
            reliability: "High - Official frame data",
            caching: "10 minutes TTL"
          },
          characterInfo: {
            source: "Wavu Wiki",
            url: "https://wavu.wiki",
            coverage: "Most Tekken 8 characters",
            updateFrequency: "Community-maintained (may lag patches)",
            reliability: "Medium-High - Community-driven",
            limitations: ["May be outdated after patches", "Completeness varies by character"],
            caching: "10 minutes TTL"
          }
        },
        capabilities: {
          frameData: {
            description: "Search and analyze move frame data",
            tools: ["searchMoves", "getMove", "getKeyMoves"],
            coverage: "All character moves with startup, block, hit, counter-hit, damage, tags",
            useFor: ["Finding safe moves", "Identifying launchers", "Discovering punishers", "Analyzing move properties"],
            confidence: 1.0
          },
          characterAnalysis: {
            description: "Character overviews, strengths, weaknesses, playstyles",
            tools: ["getCharacterOverview", "listCharacters"],
            coverage: "All Tekken 8 characters",
            useFor: ["Learning new characters", "Understanding archetypes", "Comparing playstyles"],
            confidence: 0.8,
            limitations: ["Community-maintained data", "May lag behind patches"]
          },
          training: {
            description: "Structured training programs and practice drills",
            tools: ["getTrainingDrills"],
            coverage: "All characters with 7 focus areas",
            useFor: ["Building practice routines", "Improving specific skills", "Character-specific drills"],
            confidence: 0.7,
            limitations: ["Generic drills (not personalized)", "Based on frame data + common strategies"]
          },
          metaCognition: {
            description: "Understanding server capabilities and workflows",
            tools: ["getCapabilities"],
            useFor: ["Planning multi-step tasks", "Discovering optimal workflows", "Understanding limitations"],
            confidence: 1.0
          }
        },
        commonWorkflows: [
          {
            goal: "Learn a new character from scratch",
            description: "Complete beginner's journey to understanding and practicing a character",
            estimatedTime: "5-10 minutes",
            steps: [
              {
                step: 1,
                tool: "getCharacterOverview",
                params: { character: "<character_name>" },
                purpose: "Understand playstyle, archetype, strengths, weaknesses, difficulty",
                expectedOutput: "Bio, playstyle, strengths list, weaknesses list, key techniques"
              },
              {
                step: 2,
                tool: "getKeyMoves",
                params: { character: "<character_name>" },
                purpose: "Identify most important moves: launchers, pokes, safe moves, heat engagers",
                expectedOutput: "Curated list of 10-20 essential moves with frame data"
              },
              {
                step: 3,
                tool: "searchMoves",
                params: { character: "<character_name>", maxStartup: 12, minBlock: -9 },
                purpose: "Find additional fast, safe pokes for neutral game",
                expectedOutput: "List of i12 or faster safe moves"
              },
              {
                step: 4,
                tool: "getTrainingDrills",
                params: { character: "<character_name>", focus: "fundamentals" },
                purpose: "Get structured practice routine for fundamental skills",
                expectedOutput: "Training program with drills, objectives, steps, tips"
              }
            ],
            alternativeApproaches: [
              "Skip step 3 if getKeyMoves provides enough moves",
              "Use focus: 'all' in step 4 for comprehensive training"
            ]
          },
          {
            goal: "Prepare for a specific matchup",
            description: "Learn how to fight against a specific character",
            estimatedTime: "3-5 minutes",
            steps: [
              {
                step: 1,
                tool: "getCharacterOverview",
                params: { character: "<opponent_character>" },
                purpose: "Understand opponent's gameplan, strengths, and weaknesses",
                expectedOutput: "Opponent's playstyle, what they're good at, vulnerabilities"
              },
              {
                step: 2,
                tool: "searchMoves",
                params: { character: "<opponent_character>", maxBlock: -12 },
                purpose: "Find punishable moves (launch punishable or worse)",
                expectedOutput: "List of unsafe moves to watch for and punish"
              },
              {
                step: 3,
                tool: "getKeyMoves",
                params: { character: "<opponent_character>" },
                purpose: "Know their best tools so you can respect/counter them",
                expectedOutput: "Their strongest launchers, pokes, heat engagers"
              }
            ]
          },
          {
            goal: "Optimize punishment game",
            description: "Learn optimal punishers for every situation",
            estimatedTime: "5 minutes",
            steps: [
              {
                step: 1,
                tool: "searchMoves",
                params: { character: "<your_character>", maxStartup: 10 },
                purpose: "Find i10 punisher (for -10 to -11 moves)",
                expectedOutput: "Fastest standing punisher"
              },
              {
                step: 2,
                tool: "searchMoves",
                params: { character: "<your_character>", maxStartup: 12 },
                purpose: "Find i12 punisher (for -12 to -13 moves)",
                expectedOutput: "i12 punisher (usually better damage than i10)"
              },
              {
                step: 3,
                tool: "searchMoves",
                params: { character: "<your_character>", maxStartup: 15, minCounterHit: 20 },
                purpose: "Find launchers for -14/-15 and worse",
                expectedOutput: "Launch punishers for big damage"
              },
              {
                step: 4,
                tool: "getTrainingDrills",
                params: { character: "<your_character>", focus: "punishment" },
                purpose: "Practice execution until automatic",
                expectedOutput: "Punishment drills with frame scenarios"
              }
            ]
          },
          {
            goal: "Find character's best pressure tools",
            description: "Discover moves for maintaining offensive pressure",
            estimatedTime: "2-3 minutes",
            steps: [
              {
                step: 1,
                tool: "searchMoves",
                params: { character: "<character_name>", minBlock: 0 },
                purpose: "Find plus-on-block moves (your turn after block)",
                expectedOutput: "Moves that give frame advantage on block"
              },
              {
                step: 2,
                tool: "searchMoves",
                params: { character: "<character_name>", minHit: 5, maxStartup: 15 },
                purpose: "Find moves with high hit advantage for frame traps",
                expectedOutput: "Moves that give +5 or more on hit"
              },
              {
                step: 3,
                tool: "getTrainingDrills",
                params: { character: "<character_name>", focus: "pressure" },
                purpose: "Learn to chain pressure tools effectively",
                expectedOutput: "Frame trap drills and pressure sequences"
              }
            ]
          }
        ],
        bestPractices: {
          forAgents: [
            "Always start with getCharacterOverview() when user asks about a character",
            "Chain tools logically: Overview → Key Moves → Training Drills",
            "Use searchMoves() for specific criteria, getKeyMoves() for curated essentials",
            "Handle CHARACTER_NOT_FOUND errors by parsing JSON and suggesting similar names",
            "Set user expectations about data sources (frame data = reliable, wiki = community)",
            "Suggest next steps after each tool call to guide the conversation",
            "For typos, check error.didYouMean field and auto-correct if similarity > 0.6"
          ],
          forUsers: [
            "Start with getCharacterOverview() for new characters",
            "Use getKeyMoves() for a quick essential movelist",
            "Use searchMoves() with filters for specific needs",
            "Practice with getTrainingDrills() focus areas (start with 'fundamentals')",
            "Character names are case-insensitive and use hyphens (e.g., 'devil-jin', 'jack-8')"
          ],
          workflowPatterns: [
            "Learning: Overview → Key Moves → Drills",
            "Matchup prep: Opponent Overview → Their unsafe moves → Their best tools",
            "Skill improvement: Identify weakness → Search relevant moves → Get drills",
            "Quick reference: Key Moves (curated) vs. Search Moves (custom filters)"
          ]
        },
        limitations: [
          "Training drills are generic, not personalized to player skill level",
          "No real-time matchup analysis (uses general frame data)",
          "Wavu Wiki data may be outdated after patches",
          "No video demonstrations or visual examples",
          "No combo route suggestions (only frame data provided)",
          "No player-specific statistics or ranked data",
          "Character overview quality varies by community contributions"
        ],
        errorHandling: {
          CHARACTER_NOT_FOUND: {
            format: "JSON string with error, suggestions, didYouMean",
            recovery: "Parse error JSON, check didYouMean field, auto-correct if similarity > 0.6",
            example: "Input 'lew' → suggests 'law' (90% match) → auto-retry with 'law'"
          },
          MOVE_NOT_FOUND: {
            recovery: "Suggest using searchMoves() instead of exact command lookup"
          },
          NETWORK_ERROR: {
            recovery: "Retry once, then inform user data source is temporarily unavailable"
          }
        },
        futureFeatures: [
          "Character comparison tool (compareCharacters)",
          "Matchup analysis with advantage ratings (analyzeMatchup)",
          "Gameplan suggestions (suggestGameplan)",
          "Dynamic personalized training progression",
          "Meta tier lists and tournament statistics",
          "Patch note tracking and analysis",
          "Combo route optimization"
        ]
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(capabilities, null, 2)
          }
        ]
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}