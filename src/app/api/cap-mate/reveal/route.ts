// Reveal API Route for Capitão do Mate - KASSINO-CKB
import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabaseAdmin } from "@/lib/supabase-client";
import { decryptGameState, encryptGameState, generateTokenSignature, verifyTokenSignature } from "@/lib/cap-mate-state";

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
    const { token: stateToken, signature, index } = body;
    const clickedIndex = parseInt(index);

    if (!stateToken || !signature || isNaN(clickedIndex) || clickedIndex < 0 || clickedIndex >= 36) {
      return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
    }

    // 3. Verify HMAC signature to prevent clients from tampering with the state
    const isValid = verifyTokenSignature(stateToken, signature);
    if (!isValid) {
      return NextResponse.json({ error: "Security check failed: Cheat attempt detected!" }, { status: 403 });
    }

    // 4. Decrypt game state
    const state = decryptGameState(stateToken);

    // Verify user ownership
    if (state.userId !== user.id) {
      return NextResponse.json({ error: "Security check failed: Token owner mismatch" }, { status: 403 });
    }

    // Verify index is not already revealed
    if (state.revealed.includes(clickedIndex)) {
      return NextResponse.json({ error: "Esta carta já foi revelada" }, { status: 400 });
    }

    // 5. Add index to revealed list
    state.revealed.push(clickedIndex);
    const revealedSymbol = state.grid[clickedIndex];

    // 6. Count revealed cap-mates (mines)
    const revealedMines = state.revealed.filter(idx => state.grid[idx] === "cap-mate").length;

    const supabaseAdmin = getSupabaseAdmin();

    if (revealedMines >= 2) {
      // Player hit the second mine! Game is lost.
      // Log the loss in the spins table
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .single();

      await supabaseAdmin.from("spins").insert({
        user_id: user.id,
        username: profile?.username || "Player",
        bet_amount: state.betAmount,
        win_amount: 0,
        multiplier: 0,
        symbols: ["cap-mate", "perdeu"],
        is_feature_trigger: false,
      });

      return NextResponse.json({
        status: "lost",
        symbol: revealedSymbol,
        grid: state.grid, // Expose full grid on loss
        revealedIndices: state.revealed
      });
    }

    // Game continues! Encrypt updated state and generate a new signature
    const newStateToken = encryptGameState(state);
    const newSignature = generateTokenSignature(newStateToken);

    return NextResponse.json({
      status: "playing",
      symbol: revealedSymbol,
      revealedIndices: state.revealed,
      token: newStateToken,
      signature: newSignature
    });

  } catch (err) {
    console.error("Cap-Mate reveal error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
