# Tekken MCP Server

Exposes Tekken 8 frame data from **TekkenDocs** and character information from **Wavu Wiki** as MCP resources/tools.

## Requirements

- **Node.js 18+** (requires Web Streams API)
  - If using nvm: `nvm use 20` or `nvm alias default 20`

## Quick start
```bash
npm i
npm run build         # compile TypeScript
npm run dev           # stdio mode
HTTP=1 npm run dev    # SSE mode on :1111
```

## Features

### Resources
- **tekken://characters** → List of all Tekken 8 characters
- **tekken://characters/{char}/movelist** → Complete movelist with frame data

### Tools
- **listCharacters()** → List all available characters
- **getMove({ character, command })** → Frame data for a specific move
- **searchMoves({ character, ...filters })** → Filter moves by properties (hitLevel, minBlock, maxStartup, hasTag, etc.)
- **getCharacterOverview({ character })** → Character bio, playstyle, strengths, weaknesses from Wavu Wiki
- **getKeyMoves({ character })** → Best launchers, pokes, safe moves, and heat engagers
- **getTrainingDrills({ character, focus? })** → Personalized training programs (fundamentals, combos, punishment, movement, heat, etc.)

## Testing

Use the MCP Inspector to test your server:
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Integration

Add to your MCP client configuration:
```json
{
  "mcpServers": {
    "tekken-docs": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"]
    }
  }
}
```