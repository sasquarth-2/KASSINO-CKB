// Start API Route for Capitão do Mate - KASSINO-CKB
import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabaseAdmin } from "@/lib/supabase-client";
import { encryptGameState, generateTokenSignature, CapMateGameState } from "@/lib/cap-mate-state";
import crypto from "crypto";

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Generate the 6x6 grid with mines (cap-mate) and animals
function generateGrid(): string[] {
  const totalCards = 36;
  const minesCount = 15; // Increased by 50% (from 10 to 15) to make it more difficult
  const grid: string[] = [];

  const isSuperWinRound = Math.random() < 0.10; // 10% chance

  if (isSuperWinRound) {
    // Pick one animal to have exactly 6 copies (Super Win target)
    const animals = ["chimpa", "mico", "urso"];
    const targetAnimal = animals[Math.floor(Math.random() * animals.length)];
    const otherAnimals = animals.filter(a => a !== targetAnimal);

    // 6 target animals, 15 mines, 8 of animal B, 7 of animal C
    for (let i = 0; i < 6; i++) grid.push(targetAnimal);
    for (let i = 0; i < minesCount; i++) grid.push("cap-mate");
    for (let i = 0; i < 8; i++) grid.push(otherAnimals[0]);
    for (let i = 0; i < 7; i++) grid.push(otherAnimals[1]);
  } else {
    // Normal round card distribution
    // 15 mines, 7 chimpas, 7 micos, 7 ursos
    for (let i = 0; i < minesCount; i++) grid.push("cap-mate");
    for (let i = 0; i < 7; i++) grid.push("chimpa");
    for (let i = 0; i < 7; i++) grid.push("mico");
    for (let i = 0; i < 7; i++) grid.push("urso");
  }

  return shuffleArray(grid);
}

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized: Missing auth token" }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized: Invalid session" }, { status: 401 });
    }

    // 2. Parse bet size
    const body = await req.json();
    const { betAmount } = body;
    const bet = parseFloat(betAmount);

    if (isNaN(bet) || bet < 10 || bet > 10000) {
      return NextResponse.json({ error: "Valor de aposta inválido (Mínimo CKB$ 10, Máximo CKB$ 10.000)" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 3. Fetch user balance
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("balance")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 });
    }

    const balance = parseFloat(profile.balance.toString());
    if (balance < bet) {
      return NextResponse.json({ error: "Saldo insuficiente para esta aposta" }, { status: 400 });
    }

    // 4. Deduct bet amount from user balance
    const newBalance = parseFloat((balance - bet).toFixed(2));
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq("id", user.id);

    if (updateError) {
      return NextResponse.json({ error: "Erro ao atualizar saldo" }, { status: 500 });
    }

    // 5. Generate secure game state
    const grid = generateGrid();
    const roundId = crypto.randomUUID();
    const state: CapMateGameState = {
      userId: user.id,
      roundId,
      betAmount: bet,
      grid,
      revealed: [],
      createdAt: Date.now()
    };

    // 6. Encrypt state and sign it
    const stateToken = encryptGameState(state);
    const signature = generateTokenSignature(stateToken);

    return NextResponse.json({
      token: stateToken,
      signature,
      newBalance
    });

  } catch (err) {
    console.error("Cap-Mate start error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
