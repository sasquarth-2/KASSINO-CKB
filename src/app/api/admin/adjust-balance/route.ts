// Admin Balance Adjustment API Route - Fortune Tiger Clone (KASSINO-CKB)
import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabaseAdmin } from "@/lib/supabase-client";

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

    // 4. Verify that the requester is an admin
    const { data: requesterProfile, error: reqError } = await supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (reqError || !requesterProfile || !requesterProfile.is_admin) {
      return NextResponse.json({ error: "Forbidden: Admin privileges required" }, { status: 403 });
    }

    // 5. Parse request body
    const body = await req.json();
    const { targetUsername, amount } = body;

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount === 0) {
      return NextResponse.json({ error: "Invalid amount. Must be a non-zero number." }, { status: 400 });
    }

    if (!targetUsername || typeof targetUsername !== "string") {
      return NextResponse.json({ error: "Target username is required" }, { status: 400 });
    }

    // 6. Find target user profile
    const { data: targetProfile, error: targetError } = await supabaseAdmin
      .from("profiles")
      .select("id, username, balance")
      .eq("username", targetUsername.trim())
      .single();

    if (targetError || !targetProfile) {
      return NextResponse.json({ error: `User '${targetUsername}' not found` }, { status: 404 });
    }

    const currentBalance = parseFloat(targetProfile.balance.toString());
    const newBalance = Math.max(0, currentBalance + parsedAmount);

    // 7. Update target profile balance
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        balance: parseFloat(newBalance.toFixed(2)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetProfile.id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to update target user balance" }, { status: 500 });
    }

    // 8. Log the adjustment in spins history as a special admin transaction for visibility
    await supabaseAdmin
      .from("spins")
      .insert({
        user_id: targetProfile.id,
        username: targetProfile.username,
        bet_amount: 1, // dummy value
        win_amount: parsedAmount > 0 ? parsedAmount : 0,
        multiplier: parsedAmount > 0 ? parseFloat((parsedAmount).toFixed(1)) : 0,
        symbols: [
          ["gold_ingot", "gold_ingot", "gold_ingot"],
          ["tiger_wild", "tiger_wild", "tiger_wild"],
          ["gold_ingot", "gold_ingot", "gold_ingot"]
        ], // decorative full tiger grid
        is_feature_trigger: false,
        created_at: new Date().toISOString()
      });

    return NextResponse.json({
      message: `Balance adjusted successfully for ${targetProfile.username}`,
      targetUsername: targetProfile.username,
      oldBalance: currentBalance,
      newBalance: parseFloat(newBalance.toFixed(2)),
      difference: parsedAmount
    });

  } catch (err) {
    console.error("Admin adjustment API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
