import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-client";
import crypto from "crypto";

// Calculate duration of the flight for a given crash point
// Multiplier = 1.00 + (t / 8)^2.2 => t = 8 * (Multiplier - 1.00)^(1/2.2)
function getFlightDurationMs(crashPoint: number): number {
  if (crashPoint <= 1.00) return 0;
  const durationSeconds = 8 * Math.pow(crashPoint - 1.00, 1 / 2.2);
  return Math.floor(durationSeconds * 1000);
}

// Rolls a weighted crash point
function rollCrashPoint(): number {
  const rand = Math.random();
  let crashPoint = 1.00;

  if (rand > 0.10) {
    if (rand <= 0.60) {
      // 1.01 to 2.00
      crashPoint = 1.01 + Math.random() * 0.99;
    } else if (rand <= 0.85) {
      // 2.01 to 10.00
      crashPoint = 2.01 + Math.random() * 7.99;
    } else if (rand <= 0.98) {
      // 10.01 to 50.00
      crashPoint = 10.01 + Math.random() * 39.99;
    } else {
      // 50.01 to 250.00
      crashPoint = 50.01 + Math.random() * 199.99;
    }
  }

  return parseFloat(crashPoint.toFixed(2));
}

export async function GET(req: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const now = Date.now();

    // 1. Fetch current global round state
    const { data: round, error } = await supabaseAdmin
      .from("active_crash_round")
      .select("*")
      .eq("id", 1)
      .single();

    if (error || !round) {
      return NextResponse.json({ error: "Failed to load active round" }, { status: 500 });
    }

    let currentStatus = round.status;
    let roundId = round.round_id;
    let bettingStartTime = new Date(round.betting_start_time).getTime();
    let flightStartTime = round.flight_start_time ? new Date(round.flight_start_time).getTime() : null;
    let crashPoint = parseFloat(round.crash_point.toString());
    let updatedAt = new Date(round.updated_at).getTime();

    let needsUpdate = false;

    // 2. Evaluate State Machine Transitions
    if (currentStatus === "betting") {
      const bettingDurationMs = 8000; // 8 seconds countdown
      if (now - bettingStartTime >= bettingDurationMs) {
        // Transition to FLYING!
        currentStatus = "flying";
        flightStartTime = now;
        updatedAt = now;
        needsUpdate = true;
      }
    } else if (currentStatus === "flying") {
      if (flightStartTime) {
        const flightDurationMs = getFlightDurationMs(crashPoint);
        if (now - flightStartTime >= flightDurationMs) {
          // Transition to CRASHED!
          currentStatus = "crashed";
          updatedAt = now;
          needsUpdate = true;
        }
      } else {
        // Safe recover if flightStartTime is null
        currentStatus = "crashed";
        updatedAt = now;
        needsUpdate = true;
      }
    } else if (currentStatus === "crashed") {
      const crashedDurationMs = 3000; // 3 seconds freeze screen
      if (now - updatedAt >= crashedDurationMs) {
        // Transition back to BETTING (New Round)!
        currentStatus = "betting";
        roundId = crypto.randomUUID();
        bettingStartTime = now;
        flightStartTime = null;
        crashPoint = rollCrashPoint();
        updatedAt = now;
        needsUpdate = true;
      }
    }

    // 3. Update database row if state transitioned
    if (needsUpdate) {
      const { error: updateError } = await supabaseAdmin
        .from("active_crash_round")
        .update({
          round_id: roundId,
          status: currentStatus,
          betting_start_time: new Date(bettingStartTime).toISOString(),
          flight_start_time: flightStartTime ? new Date(flightStartTime).toISOString() : null,
          crash_point: crashPoint,
          updated_at: new Date(updatedAt).toISOString()
        })
        .eq("id", 1);

      if (updateError) {
        console.error("Failed to transition active round state:", updateError.message);
      }
    }

    // 4. Return synchronized values including exact server timestamp to align animations
    return NextResponse.json({
      status: currentStatus,
      roundId,
      bettingStartTime,
      flightStartTime,
      crashPoint,
      updatedAt,
      serverTime: now
    });

  } catch (err) {
    console.error("Sync API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
