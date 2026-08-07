// Daily Claim API Route - Fortune Tiger Clone (KASSINO-CKB)
import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabaseAdmin } from "@/lib/supabase-client";

const DAILY_CLAIM_AMOUNT = 5000;
const CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

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

    // 3. Initialize Supabase Admin
    const supabaseAdmin = getSupabaseAdmin();

    // 4. Fetch profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("balance, last_daily_claim")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    // 5. Check if user is eligible (cooldown verification)
    const now = new Date();
    const lastClaimStr = profile.last_daily_claim;
    
    if (lastClaimStr) {
      const lastClaimDate = new Date(lastClaimStr);
      const timeElapsed = now.getTime() - lastClaimDate.getTime();

      if (timeElapsed < CLAIM_COOLDOWN_MS) {
        const timeRemainingMs = CLAIM_COOLDOWN_MS - timeElapsed;
        const hoursRemaining = Math.floor(timeRemainingMs / (60 * 60 * 1000));
        const minutesRemaining = Math.floor((timeRemainingMs % (60 * 60 * 1000)) / (60 * 1000));
        
        return NextResponse.json({
          error: `Daily reward already claimed. Come back in ${hoursRemaining}h ${minutesRemaining}m.`,
          cooldownRemainingMs: timeRemainingMs
        }, { status: 400 });
      }
    }

    // 6. Update user balance (+5,000) and set last_daily_claim to now
    const currentBalance = parseFloat(profile.balance.toString());
    const newBalance = currentBalance + DAILY_CLAIM_AMOUNT;

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        balance: parseFloat(newBalance.toFixed(2)),
        last_daily_claim: now.toISOString(),
        updated_at: now.toISOString()
      })
      .eq("id", user.id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }

    return NextResponse.json({
      message: "Daily reward claimed successfully!",
      addedAmount: DAILY_CLAIM_AMOUNT,
      newBalance: parseFloat(newBalance.toFixed(2))
    });

  } catch (err) {
    console.error("Claim API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
