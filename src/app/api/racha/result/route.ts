// Result/Claim API Route for O Racha - KASSINO-CKB
import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabaseAdmin } from "@/lib/supabase-client";

const VEHICLE_MULTIPLIERS: Record<string, number> = {
  "ford-ka": 100.0,
  "blue-horse": 8.0,
  "yellow-horse": 5.0,
  "green-horse": 4.0,
  "purpple-horse": 2.0
};

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

    // 3. Fetch active round state to verify the winning vehicle
    const { data: round, error: roundError } = await supabaseAdmin
      .from("active_racha_round")
      .select("*")
      .eq("id", 1)
      .single();

    if (roundError || !round) {
      return NextResponse.json({ error: "Falha ao carregar estado da corrida" }, { status: 500 });
    }

    if (round.round_id !== roundId) {
      return NextResponse.json({ error: "Esta corrida já expirou!" }, { status: 400 });
    }

    // Secure: Only allow result resolution once the race has finished (status === reset)
    if (round.status === "betting" || round.status === "racing") {
      return NextResponse.json({ error: "A corrida ainda está acontecendo!" }, { status: 400 });
    }

    const winningVehicle = round.winning_vehicle;

    // 4. Fetch the player's bet for this round
    const { data: bet, error: betError } = await supabaseAdmin
      .from("racha_bets")
      .select("*")
      .eq("user_id", user.id)
      .eq("round_id", roundId)
      .single();

    if (betError || !bet) {
      // If no bet was placed by the user, return negative
      return NextResponse.json({ won: false, hasBet: false, winningVehicle });
    }

    // 5. If bet has already been processed (prevent double-claims)
    if (bet.status !== "pending") {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("balance")
        .eq("id", user.id)
        .single();
      
      const multiplier = VEHICLE_MULTIPLIERS[bet.selected_vehicle] || 2.0;
      return NextResponse.json({
        won: bet.status === "won",
        hasBet: true,
        winAmount: bet.status === "won" ? parseFloat((bet.bet_amount * multiplier).toFixed(2)) : 0,
        multiplier: bet.status === "won" ? multiplier : 0,
        newBalance: profile ? parseFloat(profile.balance.toString()) : 0,
        winningVehicle
      });
    }

    // 6. Evaluate result
    const didWin = bet.selected_vehicle === winningVehicle;
    const multiplier = VEHICLE_MULTIPLIERS[winningVehicle] || 2.0;
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
        .from("racha_bets")
        .update({ status: "won" })
        .eq("id", bet.id);

      // Log the win in spins table
      await supabaseAdmin.from("spins").insert({
        user_id: user.id,
        username: profile.username,
        bet_amount: bet.bet_amount,
        win_amount: winAmount,
        multiplier: multiplier,
        symbols: ["racha", bet.selected_vehicle, winningVehicle],
        is_feature_trigger: false,
      });

      return NextResponse.json({
        won: true,
        hasBet: true,
        winAmount,
        multiplier,
        newBalance,
        winningVehicle
      });
    } else {
      // User lost!
      // Update bet status
      await supabaseAdmin
        .from("racha_bets")
        .update({ status: "lost" })
        .eq("id", bet.id);

      // Log the loss in spins table
      await supabaseAdmin.from("spins").insert({
        user_id: user.id,
        username: profile.username,
        bet_amount: bet.bet_amount,
        win_amount: 0,
        multiplier: 0,
        symbols: ["racha", bet.selected_vehicle, winningVehicle],
        is_feature_trigger: false,
      });

      return NextResponse.json({
        won: false,
        hasBet: true,
        winningVehicle,
        newBalance
      });
    }

  } catch (err) {
    console.error("Racha result API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
