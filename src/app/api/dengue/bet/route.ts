// Bet API Route for Blackjack da Dengue - KASSINO-CKB
import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabaseAdmin } from "@/lib/supabase-client";

const VALID_CARDS = ["dengue", "cigaro", "frango", "cap-mate", "sapo"];

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
    const { betAmount, selectedCard } = body;
    const bet = parseFloat(betAmount);

    if (isNaN(bet) || bet < 10 || bet > 10000) {
      return NextResponse.json({ error: "Valor de aposta inválido (Mínimo CKB$ 10, Máximo CKB$ 10.000)" }, { status: 400 });
    }

    if (!selectedCard || !VALID_CARDS.includes(selectedCard)) {
      return NextResponse.json({ error: "Carta selecionada inválida" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 3. Verify current round is in betting phase
    const { data: round, error: roundError } = await supabaseAdmin
      .from("active_dengue_round")
      .select("*")
      .eq("id", 1)
      .single();

    if (roundError || !round) {
      return NextResponse.json({ error: "Falha ao obter rodada ativa" }, { status: 500 });
    }

    if (round.status !== "betting") {
      return NextResponse.json({ error: "As apostas para esta rodada já se encerraram!" }, { status: 400 });
    }

    const roundId = round.round_id;

    // 4. Check if user already placed a bet on this round
    const { data: existingBet, error: checkError } = await supabaseAdmin
      .from("dengue_bets")
      .select("id")
      .eq("user_id", user.id)
      .eq("round_id", roundId)
      .maybeSingle();

    if (checkError) {
      return NextResponse.json({ error: "Erro ao verificar aposta existente" }, { status: 500 });
    }

    if (existingBet) {
      return NextResponse.json({ error: "Você já realizou uma aposta nesta rodada!" }, { status: 400 });
    }

    // 5. Fetch user profile balance
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("balance")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 });
    }

    const currentBalance = parseFloat(profile.balance.toString());
    if (currentBalance < bet) {
      return NextResponse.json({ error: "Saldo insuficiente" }, { status: 400 });
    }

    // 6. Deduct balance
    const newBalance = parseFloat((currentBalance - bet).toFixed(2));
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq("id", user.id);

    if (updateError) {
      return NextResponse.json({ error: "Erro ao debitar saldo" }, { status: 500 });
    }

    // 7. Insert bet record
    const { error: insertError } = await supabaseAdmin
      .from("dengue_bets")
      .insert({
        user_id: user.id,
        round_id: roundId,
        bet_amount: bet,
        selected_card: selectedCard,
        status: "pending"
      });

    if (insertError) {
      // Refund balance on database insert failure
      await supabaseAdmin
        .from("profiles")
        .update({ balance: currentBalance })
        .eq("id", user.id);
      return NextResponse.json({ error: "Falha ao registrar aposta" }, { status: 500 });
    }

    return NextResponse.json({
      message: "Aposta lançada com sucesso!",
      newBalance,
      roundId
    });

  } catch (err) {
    console.error("Dengue bet error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
