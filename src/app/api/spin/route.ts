// Spin API Route - Fortune Tiger Clone (KASSINO-CKB)
import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabaseAdmin } from "@/lib/supabase-client";
import { executeSpin } from "@/lib/slot-engine";

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
    const { betAmount, forceFeature } = body;

    // Validate bet amount
    const parsedBet = parseFloat(betAmount);
    if (isNaN(parsedBet) || parsedBet <= 0) {
      return NextResponse.json({ error: "Invalid bet amount" }, { status: 400 });
    }

    // Allow forceFeature in development mode only
    const isDev = process.env.NODE_ENV === "development";
    const shouldForceFeature = isDev && !!forceFeature;

    // 4. Initialize Supabase Admin (bypasses RLS to write balances)
    const supabaseAdmin = getSupabaseAdmin();

    // 5. Fetch profile balance
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

    // 6. Execute spin
    const spinResult = executeSpin(parsedBet, shouldForceFeature);

    // Calculate new balance
    // Deduct bet and add win
    const newBalance = currentBalance - parsedBet + spinResult.totalWin;

    // 7. Update profile balance
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

    // 8. Log the spin in database
    const { error: logError } = await supabaseAdmin
      .from("spins")
      .insert({
        user_id: user.id,
        username: profile.username,
        bet_amount: parsedBet,
        win_amount: spinResult.totalWin,
        multiplier: spinResult.totalMultiplier,
        symbols: spinResult.grid,
        is_feature_trigger: spinResult.isFeatureTrigger,
        feature_respins: spinResult.isFeatureTrigger ? spinResult.featureRespins : null,
      });

    if (logError) {
      console.error("Failed to log spin history:", logError.message);
      // We don't fail the response if history fails, but log it
    }

    // 9. Return spin result and new balance
    return NextResponse.json({
      ...spinResult,
      newBalance: parseFloat(newBalance.toFixed(2)),
    });

  } catch (err) {
    console.error("Spin API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
