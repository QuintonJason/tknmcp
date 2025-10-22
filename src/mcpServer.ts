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
  type TekkenMove,
  type SearchMovesFilters,
  type CharacterOverview,
  type TrainingProgram
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
          description: "Return array of available Tekken 8 characters.",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        },
        {
          name: "getMove",
          description: "Retrieve frame‑data for a specific move.",
          inputSchema: {
            type: "object",
            properties: {
              character: { type: "string", description: "Character name" },
              command: { type: "string", description: "Move command input" }
            },
            required: ["character", "command"]
          }
        },
        {
          name: "searchMoves",
          description: "Search and filter moves by frame data properties. Great for finding safe moves, launchers, fast attacks, etc.",
          inputSchema: {
            type: "object",
            properties: {
              character: { type: "string", description: "Character name" },
              hitLevel: {
                type: "string",
                enum: ["h", "m", "l", "s"],
                description: "Hit level: h=high, m=mid, l=low, s=special"
              },
              minDamage: { type: "number", description: "Minimum damage value" },
              maxStartup: { type: "number", description: "Maximum startup frames (for fast moves)" },
              minBlock: { type: "number", description: "Minimum block advantage (for safe moves, e.g. -10)" },
              maxBlock: { type: "number", description: "Maximum block advantage (for unsafe moves)" },
              minHit: { type: "number", description: "Minimum hit advantage (for plus frames)" },
              minCounterHit: { type: "number", description: "Minimum counter hit advantage (for launchers)" },
              hasTag: { type: "string", description: "Must have specific tag (he=heat engager, trn=tornado, etc.)" },
              limit: { type: "number", description: "Limit number of results (default: all)" }
            },
            required: ["character"]
          }
        },
        {
          name: "getCharacterOverview",
          description: "Get character overview including bio, strengths, weaknesses, and playstyle from Wavu Wiki",
          inputSchema: {
            type: "object",
            properties: {
              character: {
                type: "string",
                description: "Character name"
              }
            },
            required: ["character"]
          }
        },
        {
          name: "getKeyMoves",
          description: "Get the most important moves for a character including their best launchers, pokes, and signature techniques",
          inputSchema: {
            type: "object",
            properties: {
              character: {
                type: "string",
                description: "Character name to get key moves for"
              }
            },
            required: ["character"]
          }
        },
        {
          name: "getTrainingDrills",
          description: "Generate personalized training drills and practice routines for a character with specific focus areas",
          inputSchema: {
            type: "object",
            properties: {
              character: {
                type: "string",
                description: "Character name to generate training drills for"
              },
              focus: {
                type: "string",
                enum: ["fundamentals", "combos", "punishment", "movement", "heat", "pressure", "defense", "all"],
                description: "Training focus area (optional, defaults to 'all')"
              }
            },
            required: ["character"]
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
      const { character, ...filters } = args as any;
      const moves = await searchMoves(character, filters);

      // Check if this should use the nice table format
      const useTableFormat = shouldUseTableFormat(character, filters);

      if (useTableFormat && moves.length > 0) {
        // Use the nice summarized table format
        const title = `${character.charAt(0).toUpperCase() + character.slice(1)}'s Best Moves`;
        const tableOutput = formatMovesTable(moves, title);

        return {
          content: [
            {
              type: "text",
              text: tableOutput
            }
          ]
        };
      } else {
        // Use the detailed format for specific searches
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

        return {
          content: [
            {
              type: "text",
              text: `${summary}\n\n${movesList}`
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
        await searchMoves(character, { maxStartup: 12, minBlock: -10, limit: 5 }),
        // Safe moves
        await searchMoves(character, { minBlock: -10, limit: 5 }),
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
        resultText += `🛡️ Safe Moves (-10 or better):\n`;
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

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}