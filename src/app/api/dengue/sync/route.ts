// Sync API Route for Blackjack da Dengue - KASSINO-CKB
import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabaseAdmin } from "@/lib/supabase-client";
import crypto from "crypto";

// Rolls a weighted winning card
// dengue: 12% probability (x10 payout)
// cigaro, frango, cap-mate, sapo: 22% probability each (x4 payout)
function rollWinningCard(): string {
  const rand = Math.random();
  if (rand < 0.12) return "dengue";
  if (rand < 0.34) return "cigaro";
  if (rand < 0.56) return "frango";
  if (rand < 0.78) return "cap-mate";
  return "sapo";
}

export async function GET(req: NextRequest) {
  try {
    // 1. Validate session token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized: Missing auth header" }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized: Invalid session" }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const now = Date.now();

    // 2. Fetch current active round info
    const { data: round, error } = await supabaseAdmin
      .from("active_dengue_round")
      .select("*")
      .eq("id", 1)
      .single();

    if (error || !round) {
      return NextResponse.json({ error: "Failed to load active round state" }, { status: 500 });
    }

    let currentStatus = round.status;
    let roundId = round.round_id;
    let bettingStartTime = new Date(round.betting_start_time).getTime();
    let revealStartTime = round.reveal_start_time ? new Date(round.reveal_start_time).getTime() : null;
    let winningCard = round.winning_card;
    let updatedAt = new Date(round.updated_at).getTime();

    let needsUpdate = false;

    // 3. Evaluate state machine transitions
    if (currentStatus === "betting") {
      const bettingDurationMs = 10000; // 10 seconds betting countdown
      if (now - bettingStartTime >= bettingDurationMs) {
        // Transition to REVEALING!
        currentStatus = "revealing";
        revealStartTime = now;
        winningCard = rollWinningCard();
        updatedAt = now;
        needsUpdate = true;
      }
    } else if (currentStatus === "revealing") {
      const revealDurationMs = 3000; // 3 seconds card reveal pause
      if (revealStartTime && now - revealStartTime >= revealDurationMs) {
        // Transition to RESET (prepare for next round)
        currentStatus = "reset";
        updatedAt = now;
        needsUpdate = true;
      }
    } else if (currentStatus === "reset") {
      const resetDurationMs = 3000; // 3 seconds reset screen before new round
      if (now - updatedAt >= resetDurationMs) {
        // Transition back to BETTING (Start New Round)
        currentStatus = "betting";
        roundId = crypto.randomUUID();
        bettingStartTime = now;
        revealStartTime = null;
        winningCard = null;
        updatedAt = now;
        needsUpdate = true;
      }
    }

    // 4. Save state if transitioned
    if (needsUpdate) {
      const { error: updateError } = await supabaseAdmin
        .from("active_dengue_round")
        .update({
          round_id: roundId,
          status: currentStatus,
          betting_start_time: new Date(bettingStartTime).toISOString(),
          reveal_start_time: revealStartTime ? new Date(revealStartTime).toISOString() : null,
          winning_card: winningCard,
          updated_at: new Date(updatedAt).toISOString()
        })
        .eq("id", 1);

      if (updateError) {
        console.error("Failed to transition active dengue round:", updateError.message);
      }
    }

    // Hide winning card during active betting phase to prevent client sniffing
    const publicWinningCard = currentStatus === "betting" ? null : winningCard;

    return NextResponse.json({
      status: currentStatus,
      roundId,
      bettingStartTime,
      revealStartTime,
      winningCard: publicWinningCard,
      updatedAt,
      serverTime: now
    });

  } catch (err) {
    console.error("Dengue sync API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
