// Result/Claim API Route for Blackjack da Dengue - KASSINO-CKB
import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabaseAdmin } from "@/lib/supabase-client";

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
    const { roundId } = body;

    if (!roundId) {
      return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 3. Fetch active round state to verify the winning card
    const { data: round, error: roundError } = await supabaseAdmin
      .from("active_dengue_round")
      .select("*")
      .eq("id", 1)
      .single();

    if (roundError || !round) {
      return NextResponse.json({ error: "Falha ao carregar estado da rodada" }, { status: 500 });
    }

    if (round.round_id !== roundId) {
      return NextResponse.json({ error: "Esta rodada já expirou!" }, { status: 400 });
    }

    if (round.status === "betting") {
      return NextResponse.json({ error: "A rodada ainda está em fase de apostas!" }, { status: 400 });
    }

    const winningCard = round.winning_card;

    // 4. Fetch the player's bet for this round
    const { data: bet, error: betError } = await supabaseAdmin
      .from("dengue_bets")
      .select("*")
      .eq("user_id", user.id)
      .eq("round_id", roundId)
      .single();

    if (betError || !bet) {
      // If no bet was placed by the user, return negative
      return NextResponse.json({ won: false, hasBet: false, winningCard });
    }

    // 5. If bet has already been processed (prevent double-claims)
    if (bet.status !== "pending") {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("balance")
        .eq("id", user.id)
        .single();
      
      const multiplier = bet.selected_card === "dengue" ? 10.0 : 4.0;
      return NextResponse.json({
        won: bet.status === "won",
        hasBet: true,
        winAmount: bet.status === "won" ? parseFloat((bet.bet_amount * multiplier).toFixed(2)) : 0,
        multiplier: bet.status === "won" ? multiplier : 0,
        newBalance: profile ? parseFloat(profile.balance.toString()) : 0,
        winningCard
      });
    }

    // 6. Evaluate result
    const didWin = bet.selected_card === winningCard;
    const multiplier = winningCard === "dengue" ? 10.0 : 4.0;
    const winAmount = parseFloat((bet.bet_amount * multiplier).toFixed(2));

    // Fetch profile info
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("balance, username")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 });
    }

    const currentBalance = parseFloat(profile.balance.toString());
    let newBalance = currentBalance;

    if (didWin) {
      // User won! Credit balance
      newBalance = parseFloat((currentBalance + winAmount).toFixed(2));
      
      // Update balance
      await supabaseAdmin
        .from("profiles")
        .update({
          balance: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq("id", user.id);

      // Update bet status
      await supabaseAdmin
        .from("dengue_bets")
        .update({ status: "won" })
        .eq("id", bet.id);

      // Log the win in spins table
      await supabaseAdmin.from("spins").insert({
        user_id: user.id,
        username: profile.username,
        bet_amount: bet.bet_amount,
        win_amount: winAmount,
        multiplier: multiplier,
        symbols: ["dengue", bet.selected_card, winningCard],
        is_feature_trigger: false,
      });

      return NextResponse.json({
        won: true,
        hasBet: true,
        winAmount,
        multiplier,
        newBalance,
        winningCard
      });
    } else {
      // User lost!
      // Update bet status
      await supabaseAdmin
        .from("dengue_bets")
        .update({ status: "lost" })
        .eq("id", bet.id);

      // Log the loss in spins table
      await supabaseAdmin.from("spins").insert({
        user_id: user.id,
        username: profile.username,
        bet_amount: bet.bet_amount,
        win_amount: 0,
        multiplier: 0,
        symbols: ["dengue", bet.selected_card, winningCard],
        is_feature_trigger: false,
      });

      return NextResponse.json({
        won: false,
        hasBet: true,
        winningCard,
        newBalance
      });
    }

  } catch (err) {
    console.error("Dengue result API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
