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

    // 6. Roll random crashPoint (Weighted odds simulation)
    // 10% chance of instant crash at 1.00x
    // 50% chance of crash between 1.01x and 2.00x
    // 25% chance of crash between 2.01x and 10.00x
    // 13% chance of crash between 10.01x and 50.00x
    // 2% chance of extreme high crash up to 250x
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

    // Round crash point to 2 decimal places
    crashPoint = parseFloat(crashPoint.toFixed(2));

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
    // We use the Supabase Service Role key as our private encryption secret
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "kassino-secret-fallback";
    const timestamp = Date.now().toString();
    const payload = `${user.id}:${parsedBet.toFixed(2)}:${crashPoint.toFixed(2)}:${timestamp}`;
    
    const signature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    return NextResponse.json({
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
