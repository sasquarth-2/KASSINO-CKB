// Sync API Route for O Racha (Racha do Ka) - KASSINO-CKB
import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabaseAdmin } from "@/lib/supabase-client";
import crypto from "crypto";

// Rolls a weighted winning vehicle
// ford-ka: 0.9% probability (x100 payout)
// blue-horse: 11.5% probability (x8 payout)
// yellow-horse: 18.0% probability (x5 payout)
// green-horse: 23.6% probability (x4 payout)
// purpple-horse: 46.0% probability (x2 payout)
function rollWinningVehicle(): string {
  const rand = Math.random();
  if (rand < 0.009) return "ford-ka";
  if (rand < 0.124) return "blue-horse";
  if (rand < 0.304) return "yellow-horse";
  if (rand < 0.540) return "green-horse";
  return "purpple-horse";
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
      .from("active_racha_round")
      .select("*")
      .eq("id", 1)
      .single();

    if (error || !round) {
      return NextResponse.json({ error: "Failed to load active round state" }, { status: 500 });
    }

    let currentStatus = round.status;
    let roundId = round.round_id;
    let bettingStartTime = new Date(round.betting_start_time).getTime();
    let raceStartTime = round.race_start_time ? new Date(round.race_start_time).getTime() : null;
    let winningVehicle = round.winning_vehicle;
    let updatedAt = new Date(round.updated_at).getTime();

    let needsUpdate = false;

    // 3. Evaluate state machine transitions
    if (currentStatus === "betting") {
      const bettingDurationMs = 10000; // 10 seconds betting countdown
      if (now - bettingStartTime >= bettingDurationMs) {
        // Transition to RACING!
        currentStatus = "racing";
        raceStartTime = now;
        winningVehicle = rollWinningVehicle();
        updatedAt = now;
        needsUpdate = true;
      }
    } else if (currentStatus === "racing") {
      const raceDurationMs = 8000; // 8 seconds straight race track animation
      if (raceStartTime && now - raceStartTime >= raceDurationMs) {
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
        raceStartTime = null;
        winningVehicle = null;
        updatedAt = now;
        needsUpdate = true;
      }
    }

    // 4. Save state if transitioned
    if (needsUpdate) {
      const { error: updateError } = await supabaseAdmin
        .from("active_racha_round")
        .update({
          round_id: roundId,
          status: currentStatus,
          betting_start_time: new Date(bettingStartTime).toISOString(),
          race_start_time: raceStartTime ? new Date(raceStartTime).toISOString() : null,
          winning_vehicle: winningVehicle,
          updated_at: new Date(updatedAt).toISOString()
        })
        .eq("id", 1);

      if (updateError) {
        console.error("Failed to transition active racha round:", updateError.message);
      }
    }

    // Hide winning vehicle during active betting phase to prevent client sniffing
    const publicWinningVehicle = currentStatus === "betting" ? null : winningVehicle;

    return NextResponse.json({
      status: currentStatus,
      roundId,
      bettingStartTime,
      raceStartTime,
      winningVehicle: publicWinningVehicle,
      updatedAt,
      serverTime: now
    });

  } catch (err) {
    console.error("Racha sync API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
