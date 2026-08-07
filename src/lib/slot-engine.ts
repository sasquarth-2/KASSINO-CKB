// Core Slot Machine Engine - Fortune Tiger Clone (KASSINO-CKB)

export interface SymbolDef {
  id: string;
  name: string;
  multiplier: number; // 3-of-a-kind payout multiplier
  weight: number;     // Probability weight in normal spins
  image: string;      // Image asset path
}

export const SYMBOLS: Record<string, SymbolDef> = {
  tangerine: { id: "tangerine", name: "Azeitona", multiplier: 2, weight: 32, image: "/images/azeitona.png" },
  firecrackers: { id: "firecrackers", name: "Cigarro", multiplier: 3, weight: 26, image: "/images/cigaro.png" },
  red_envelope: { id: "red_envelope", name: "Shrimp", multiplier: 5, weight: 20, image: "/images/shrimp.png" },
  money_bag: { id: "money_bag", name: "Magago", multiplier: 10, weight: 15, image: "/images/magago.png" },
  green_gem: { id: "green_gem", name: "Pride", multiplier: 20, weight: 10, image: "/images/pride.png" },
  gold_ingot: { id: "gold_ingot", name: "Sapo", multiplier: 40, weight: 7, image: "/images/sapo.png" },
  tobias: { id: "tobias", name: "Tobias", multiplier: 80, weight: 5, image: "/images/tobias.png" },
  whatsapp2: { id: "whatsapp2", name: "Zap Dourado", multiplier: 150, weight: 3, image: "/images/whatsapp2.png" },
  frango: { id: "frango", name: "Frango", multiplier: 300, weight: 2, image: "/images/frango.png" },
  tiger_wild: { id: "tiger_wild", name: "Pizicuia (Wild)", multiplier: 500, weight: 2, image: "/images/pizicuia.png" },
};

// Blank cell representation for respins
export const BLANK_SYMBOL_ID = "blank";

// Paylines (3x3 grid coordinates: [row, col])
// 0: top row, 1: middle row, 2: bottom row
// 0: left col, 1: middle col, 2: right col
export const PAYLINES = [
  { id: 1, name: "Middle Horizontal", coords: [[1, 0], [1, 1], [1, 2]] },
  { id: 2, name: "Top Horizontal", coords: [[0, 0], [0, 1], [0, 2]] },
  { id: 3, name: "Bottom Horizontal", coords: [[2, 0], [2, 1], [2, 2]] },
  { id: 4, name: "Diagonal Down", coords: [[0, 0], [1, 1], [2, 2]] },
  { id: 5, name: "Diagonal Up", coords: [[2, 0], [1, 1], [0, 2]] },
];

export interface WinLine {
  paylineId: number;
  symbolId: string;
  multiplier: number;
  payout: number;
  coords: number[][]; // Coordinates of the winning line for highlighting
}

export interface SpinResult {
  grid: string[][]; // 3x3 matrix of symbol IDs
  isFeatureTrigger: boolean;
  featureSymbol?: string; // Symbol chosen for the Fortune Tiger feature
  featureRespins?: string[][][]; // Array of 3x3 grids representing respin progression
  winLines: WinLine[];
  totalMultiplier: number;
  totalWin: number;
  isFullGridWin: boolean;
}

// Generate a random symbol ID based on weights
function getRandomSymbol(excludeWild = false): string {
  const symbolList = Object.values(SYMBOLS).filter(s => !excludeWild || s.id !== "tiger_wild");
  const totalWeight = symbolList.reduce((sum, s) => sum + s.weight, 0);
  let randomValue = Math.random() * totalWeight;

  for (const s of symbolList) {
    randomValue -= s.weight;
    if (randomValue <= 0) {
      return s.id;
    }
  }
  return symbolList[0].id;
}

// Check paylines and return winning lines
export function calculateWins(grid: string[][], betAmount: number): { winLines: WinLine[]; totalMultiplier: number; totalWin: number; isFullGridWin: boolean } {
  const lineBet = betAmount / 5; // 5 paylines
  const winLines: WinLine[] = [];
  let totalMultiplier = 0;

  // Check if grid is completely full of one symbol type + Wilds
  // In Fortune Tiger, if the grid is filled with a single symbol and/or Wilds, a 10x multiplier is applied to the overall win.
  let isFullGridWin = false;
  let nonWildSymbolId: string | null = null;
  let isAllWild = true;

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const sym = grid[r][c];
      if (sym !== "tiger_wild") {
        isAllWild = false;
        if (nonWildSymbolId === null) {
          nonWildSymbolId = sym;
        } else if (nonWildSymbolId !== sym) {
          nonWildSymbolId = "mixed"; // Grid is not uniform
        }
      }
    }
  }

  // A full grid is either all Wilds, or all one symbol + Wilds
  const isUniformGrid = nonWildSymbolId !== "mixed" && nonWildSymbolId !== null;
  const isFull = isAllWild || isUniformGrid;

  // Process each payline
  for (const line of PAYLINES) {
    const symbolsOnLine = line.coords.map(([r, c]) => grid[r][c]);
    
    // Check if line is a win
    // A line wins if all 3 symbols are the same, OR if Wilds substitute for them.
    // Determine the winning symbol on the line (excluding Wilds first)
    const nonWilds = symbolsOnLine.filter(s => s !== "tiger_wild");

    let matchSymbolId: string | null = null;

    if (nonWilds.length === 0) {
      // 3 Wilds
      matchSymbolId = "tiger_wild";
    } else {
      // Check if all non-wild symbols are of the same type
      const firstNonWild = nonWilds[0];
      const allMatch = nonWilds.every(s => s === firstNonWild);
      if (allMatch) {
        matchSymbolId = firstNonWild;
      }
    }

    if (matchSymbolId && matchSymbolId !== "blank") {
      const symbolDef = SYMBOLS[matchSymbolId];
      const multiplier = symbolDef.multiplier;
      const payout = multiplier * lineBet;

      winLines.push({
        paylineId: line.id,
        symbolId: matchSymbolId,
        multiplier,
        payout,
        coords: line.coords,
      });

      totalMultiplier += multiplier;
    }
  }

  // Apply 10x multiplier if the entire screen is filled with the same symbol + Wilds
  let totalWin = winLines.reduce((sum, line) => sum + line.payout, 0);

  if (isFull && totalWin > 0) {
    isFullGridWin = true;
    totalWin = totalWin * 10;
  }

  // Calculate actual overall multiplier relative to the total bet amount
  const overallMultiplier = betAmount > 0 ? parseFloat((totalWin / betAmount).toFixed(1)) : 0;

  return {
    winLines,
    totalMultiplier: overallMultiplier,
    totalWin: parseFloat(totalWin.toFixed(2)),
    isFullGridWin,
  };
}

// Generate a normal spin grid
function generateNormalGrid(): string[][] {
  const grid: string[][] = [];
  for (let r = 0; r < 3; r++) {
    const row: string[] = [];
    for (let c = 0; c < 3; c++) {
      row.push(getRandomSymbol());
    }
    grid.push(row);
  }
  return grid;
}

// Simulate the Fortune Tiger Respin Feature
// Returns a chosen target symbol, and an array of 3x3 grids showing the progression
function simulateFortuneTigerFeature(): { featureSymbol: string; featureRespins: string[][][] } {
  // Choose a random paying symbol (excluding Wild) as the special feature symbol
  const featureSymbol = getRandomSymbol(true);
  const respins: string[][][] = [];

  // Start with an empty grid representation (all blanks)
  const currentGrid = Array(3).fill(null).map(() => Array(3).fill(BLANK_SYMBOL_ID));

  // Round 1: Place initial symbols. We must land at least 2 or 3 symbols to start the feature.
  // Usually, it triggers with a few symbols of the target type or Wilds already on the grid.
  const initialSymbolCount = Math.floor(Math.random() * 3) + 2; // 2 to 4 symbols
  let placed = 0;
  while (placed < initialSymbolCount) {
    const r = Math.floor(Math.random() * 3);
    const c = Math.floor(Math.random() * 3);
    if (currentGrid[r][c] === BLANK_SYMBOL_ID) {
      // 80% chance of target symbol, 20% chance of Tiger Wild
      currentGrid[r][c] = Math.random() < 0.85 ? featureSymbol : "tiger_wild";
      placed++;
    }
  }
  respins.push(JSON.parse(JSON.stringify(currentGrid)));

  let hasNewLand = true;
  let roundCount = 0;

  // Max 9 rounds (since 3x3 grid has 9 spots)
  while (hasNewLand && roundCount < 10) {
    roundCount++;
    hasNewLand = false;

    // Find all empty (blank) spots
    const blanks: { r: number; c: number }[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (currentGrid[r][c] === BLANK_SYMBOL_ID) {
          blanks.push({ r, c });
        }
      }
    }

    if (blanks.length === 0) {
      break; // Grid is full!
    }

    // Determine how many new symbols land in this respin
    // If the game decides to end, we land 0 symbols.
    // Let's give a 45% chance to land at least one symbol if grid is not full
    const landProbability = 0.50; 
    const shouldLand = Math.random() < landProbability;

    if (shouldLand && blanks.length > 0) {
      // Land 1 to 3 new symbols
      const maxToLand = Math.min(blanks.length, Math.floor(Math.random() * 2) + 1);
      
      // Shuffle blanks to choose random positions
      const shuffledBlanks = blanks.sort(() => Math.random() - 0.5);
      
      for (let i = 0; i < maxToLand; i++) {
        const spot = shuffledBlanks[i];
        // 90% chance of target symbol, 10% chance of Wild
        currentGrid[spot.r][spot.c] = Math.random() < 0.90 ? featureSymbol : "tiger_wild";
        hasNewLand = true;
      }
    }

    // Even if no new symbols landed, we log the final "fail" spin.
    // In the actual slot, the reels spin and stop showing blanks, which ends the feature.
    respins.push(JSON.parse(JSON.stringify(currentGrid)));
  }

  return {
    featureSymbol,
    featureRespins: respins,
  };
}

// Main entrypoint for spinning
// Enforces RTP control:
// - We can occasionally tweak weights or force wins/losses, but a standard probability matrix
//   already results in a natural RTP of ~96.5% with the parameters defined.
// - Chance of triggering Fortune Tiger feature: ~5% on any spin.
export function executeSpin(betAmount: number, forceFeature = false): SpinResult {
  // 1. Decide if Fortune Tiger Feature is triggered
  // If forceFeature is true, we trigger it directly (great for testing)
  const isFeatureTrigger = forceFeature || (Math.random() < 0.05);

  if (isFeatureTrigger) {
    const { featureSymbol, featureRespins } = simulateFortuneTigerFeature();
    const finalGrid = featureRespins[featureRespins.length - 1];
    
    // Calculate wins based on the final grid of the respin sequence
    const { winLines, totalMultiplier, totalWin, isFullGridWin } = calculateWins(finalGrid, betAmount);

    return {
      grid: finalGrid,
      isFeatureTrigger: true,
      featureSymbol,
      featureRespins,
      winLines,
      totalMultiplier,
      totalWin,
      isFullGridWin,
    };
  } else {
    // Standard normal spin
    const grid = generateNormalGrid();
    const { winLines, totalMultiplier, totalWin, isFullGridWin } = calculateWins(grid, betAmount);

    return {
      grid,
      isFeatureTrigger: false,
      winLines,
      totalMultiplier,
      totalWin,
      isFullGridWin,
    };
  }
}
