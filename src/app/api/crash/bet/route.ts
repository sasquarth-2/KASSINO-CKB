// Secure Bet API Route for Aviãozinho (Crash Game) - KASSINO-CKB
import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabaseAdmin } from "@/lib/supabase-client";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    // 1. Get auth token from Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized: Missing auth header" }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];

    // 2. Validate token and get user info
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized: Invalid session" }, { status: 401 });
    }

    // 3. Parse request body
    const body = await req.json();
    const { betAmount } = body;

    const parsedBet = parseFloat(betAmount);
    if (isNaN(parsedBet) || parsedBet <= 0) {
      return NextResponse.json({ error: "Invalid bet amount" }, { status: 400 });
    }

    // 4. Initialize Supabase Admin
    const supabaseAdmin = getSupabaseAdmin();

    // 5. Fetch current global round state
    const { data: round, error: roundError } = await supabaseAdmin
      .from("active_crash_round")
      .select("*")
      .eq("id", 1)
      .single();

    if (roundError || !round) {
      return NextResponse.json({ error: "Failed to load active round info" }, { status: 500 });
    }

    // Verify round status
    if (round.status !== "betting") {
      return NextResponse.json({ error: "A rodada já iniciou! Aguarde o próximo voo." }, { status: 400 });
    }

    const roundId = round.round_id;
    const crashPoint = parseFloat(round.crash_point.toString());

    // 6. Fetch profile balance
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("balance, username")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const currentBalance = parseFloat(profile.balance.toString());

    // Check if user has sufficient funds
    if (currentBalance < parsedBet) {
      return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
    }

    // 7. Deduct bet amount from user profile
    const newBalance = currentBalance - parsedBet;
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        balance: parseFloat(newBalance.toFixed(2)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to update balance" }, { status: 500 });
    }

    // 8. Generate HMAC Signature of the game parameters to prevent client tampering
    // We sign the userId, the bet amount, the crashPoint, the roundId, and a timestamp
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "kassino-secret-fallback";
    const timestamp = Date.now().toString();
    const payload = `${user.id}:${parsedBet.toFixed(2)}:${crashPoint.toFixed(2)}:${roundId}:${timestamp}`;
    
    const signature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    return NextResponse.json({
      roundId,
      crashPoint,
      betAmount: parsedBet,
      timestamp,
      signature,
      newBalance: parseFloat(newBalance.toFixed(2)),
    });

  } catch (err) {
    console.error("Crash bet API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
