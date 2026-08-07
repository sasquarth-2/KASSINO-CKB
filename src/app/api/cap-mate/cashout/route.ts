// Cashout API Route for Capitão do Mate - KASSINO-CKB
import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabaseAdmin } from "@/lib/supabase-client";
import { decryptGameState, verifyTokenSignature } from "@/lib/cap-mate-state";

// Helper to calculate total multiplier from revealed symbols
function calculateMultiplier(grid: string[], revealed: number[]): number {
  let chimpaCount = 0;
  let micoCount = 0;
  let ursoCount = 0;

  revealed.forEach(idx => {
    const symbol = grid[idx];
    if (symbol === "chimpa") chimpaCount++;
    if (symbol === "mico") micoCount++;
    if (symbol === "urso") ursoCount++;
  });

  let chimpaMult = 0;
  if (chimpaCount >= 6) chimpaMult = 15.0;
  else if (chimpaCount >= 4) chimpaMult = 3.0;
  else if (chimpaCount >= 3) chimpaMult = 1.5;

  let micoMult = 0;
  if (micoCount >= 6) micoMult = 25.0;
  else if (micoCount >= 4) micoMult = 4.5;
  else if (micoCount >= 3) micoMult = 2.0;

  let ursoMult = 0;
  if (ursoCount >= 6) ursoMult = 50.0;
  else if (ursoCount >= 4) ursoMult = 6.0;
  else if (ursoCount >= 3) ursoMult = 3.0;

  return parseFloat((chimpaMult + micoMult + ursoMult).toFixed(2));
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

    // 2. Parse body parameters
    const body = await req.json();
    const { token: stateToken, signature } = body;

    if (!stateToken || !signature) {
      return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
    }

    // 3. Verify HMAC signature
    const isValid = verifyTokenSignature(stateToken, signature);
    if (!isValid) {
      return NextResponse.json({ error: "Security check failed: Cheat attempt detected!" }, { status: 403 });
    }

    // 4. Decrypt game state
    const state = decryptGameState(stateToken);

    // Verify user ownership
    if (state.userId !== user.id) {
      return NextResponse.json({ error: "Security check failed: Token mismatch" }, { status: 403 });
    }

    // Verify user has revealed at least 1 card
    if (state.revealed.length === 0) {
      return NextResponse.json({ error: "Você precisa revelar pelo menos uma carta antes de retirar o prêmio" }, { status: 400 });
    }

    // Verify that they didn't hit 2 mines (which is already a loss, shouldn't be cashing out)
    const revealedMines = state.revealed.filter(idx => state.grid[idx] === "cap-mate").length;
    if (revealedMines >= 2) {
      return NextResponse.json({ error: "Você já perdeu esta rodada!" }, { status: 400 });
    }

    // 5. Calculate payout multiplier
    const totalMultiplier = calculateMultiplier(state.grid, state.revealed);

    // Verify player actually has a multiplier (need at least 3 matching cards of some animal)
    if (totalMultiplier <= 0) {
      return NextResponse.json({ error: "Você precisa formar pelo menos um conjunto de 3 cartas iguais para poder retirar o prêmio" }, { status: 400 });
    }

    const winAmount = parseFloat((state.betAmount * totalMultiplier).toFixed(2));

    const supabaseAdmin = getSupabaseAdmin();

    // 6. Fetch user profile balance
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("balance, username")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 });
    }

    // 7. Update balance
    const currentBalance = parseFloat(profile.balance.toString());
    const newBalance = parseFloat((currentBalance + winAmount).toFixed(2));

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq("id", user.id);

    if (updateError) {
      return NextResponse.json({ error: "Erro ao creditar prêmio" }, { status: 500 });
    }

    // 8. Log the win in database
    await supabaseAdmin.from("spins").insert({
      user_id: user.id,
      username: profile.username,
      bet_amount: state.betAmount,
      win_amount: winAmount,
      multiplier: totalMultiplier,
      symbols: ["cap-mate", "ganhou", totalMultiplier.toFixed(1)],
      is_feature_trigger: false,
    });

    return NextResponse.json({
      winAmount,
      totalMultiplier,
      newBalance,
      grid: state.grid // Reveal full grid on cashout
    });

  } catch (err) {
    console.error("Cap-Mate cashout error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
