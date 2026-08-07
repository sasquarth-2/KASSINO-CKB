// Secure Cashout API Route for Aviãozinho (Crash Game) - KASSINO-CKB
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
    const { betAmount, cashoutMultiplier, crashPoint, timestamp, signature } = body;

    const parsedBet = parseFloat(betAmount);
    const parsedCashout = parseFloat(cashoutMultiplier);
    const parsedCrash = parseFloat(crashPoint);

    if (isNaN(parsedBet) || isNaN(parsedCashout) || isNaN(parsedCrash)) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    // 4. Verify HMAC signature to prevent clients from forging crash points or bet amounts
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "kassino-secret-fallback";
    const payload = `${user.id}:${parsedBet.toFixed(2)}:${parsedCrash.toFixed(2)}:${timestamp}`;
    
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    if (signature !== expectedSignature) {
      return NextResponse.json({ error: "Security check failed: Cheat attempt detected!" }, { status: 403 });
    }

    // 5. Verify that they cashed out BEFORE the plane crashed
    if (parsedCashout > parsedCrash) {
      // Player cashed out AFTER the crash point! They lose.
      // Log the loss in the database
      const supabaseAdmin = getSupabaseAdmin();
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .single();

      await supabaseAdmin.from("spins").insert({
        user_id: user.id,
        username: profile?.username || "Player",
        bet_amount: parsedBet,
        win_amount: 0,
        multiplier: 0,
        symbols: ["crash", "perdeu", parsedCrash.toFixed(2)],
        is_feature_trigger: false,
      });

      return NextResponse.json({ error: "Decolou! Você não conseguiu fazer o Cash Out a tempo." }, { status: 400 });
    }

    // 6. Calculate win amount
    const winAmount = parseFloat((parsedBet * parsedCashout).toFixed(2));

    // 7. Initialize Supabase Admin and update balance
    const supabaseAdmin = getSupabaseAdmin();

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("balance, username")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const currentBalance = parseFloat(profile.balance.toString());
    const newBalance = currentBalance + winAmount;

    // 8. Save new balance
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

    // 9. Log the win in database
    await supabaseAdmin.from("spins").insert({
      user_id: user.id,
      username: profile.username,
      bet_amount: parsedBet,
      win_amount: winAmount,
      multiplier: parsedCashout,
      symbols: ["crash", parsedCashout.toFixed(2), parsedCrash.toFixed(2)],
      is_feature_trigger: false,
    });

    return NextResponse.json({
      message: "Cashout processed successfully!",
      winAmount,
      newBalance: parseFloat(newBalance.toFixed(2)),
    });

  } catch (err) {
    console.error("Crash cashout API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
