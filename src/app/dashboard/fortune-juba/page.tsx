// Game Dashboard & Slot UI - Fortune Tiger Clone (KASSINO-CKB)
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import { gameAudio } from "@/lib/audio-manager";
import { SYMBOLS, BLANK_SYMBOL_ID, WinLine } from "@/lib/slot-engine";
import { 
  Volume2, VolumeX, LogOut, Coins, Crown, Flame, 
  History, Calendar, RotateCcw, AlertCircle, Sparkles, CheckCircle2, Home
} from "lucide-react";
import confetti from "canvas-confetti";

interface Profile {
  id: string;
  username: string;
  balance: number;
  last_daily_claim: string | null;
  is_admin: boolean;
}

interface SpinFeedItem {
  id: string;
  username: string;
  bet_amount: number;
  win_amount: number;
  multiplier: number;
  is_feature_trigger: boolean;
  created_at: string;
}

interface SpinResultResponse {
  grid: string[][];
  isFeatureTrigger: boolean;
  featureSymbol?: string;
  featureRespins?: string[][][];
  winLines: WinLine[];
  totalMultiplier: number;
  totalWin: number;
  isFullGridWin: boolean;
  newBalance: number;
}

export default function Dashboard() {
  const router = useRouter();

  // Auth & Profile state
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [sessionToken, setSessionToken] = useState("");

  // Game configuration
  const [bet, setBet] = useState(100);
  const betLevels = [10, 20, 50, 100, 200, 500, 1000];

  // Game UI state
  const [grid, setGrid] = useState<string[][]>([
    ["tangerine", "firecrackers", "red_envelope"],
    ["money_bag", "green_gem", "gold_ingot"],
    ["tiger_wild", "tangerine", "firecrackers"]
  ]);
  const [spinning, setSpinning] = useState(false);
  const [activeColumns, setActiveColumns] = useState<boolean[]>([false, false, false]);
  const [winLines, setWinLines] = useState<WinLine[]>([]);
  const [tigerState, setTigerState] = useState<"idle" | "spin" | "win" | "roar">("idle");
  const [isMuted, setIsMuted] = useState(false);

  // Auto option
  const [autoSpins, setAutoSpins] = useState(0);
  const autoSpinsRef = useRef(autoSpins);

  useEffect(() => {
    autoSpinsRef.current = autoSpins;
  }, [autoSpins]);

  // Fortune Tiger Feature Respin State
  const [inFeature, setInFeature] = useState(false);
  const [featureSymbol, setFeatureSymbol] = useState<string | null>(null);
  const [featureRound, setFeatureRound] = useState(0);
  const [featureTotalRounds, setFeatureTotalRounds] = useState(0);

  // Big Win modal celebration
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationWin, setCelebrationWin] = useState(0);
  const [celebrationMultiplier, setCelebrationMultiplier] = useState(0);

  // Leaderboard & Recent wins states
  const [leaderboard, setLeaderboard] = useState<Profile[]>([]);
  const [recentSpins, setRecentSpins] = useState<SpinFeedItem[]>([]);
  const [claimCooldown, setClaimCooldown] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Admin Panel states
  const [adminTargetUsername, setAdminTargetUsername] = useState("");
  const [adminAmount, setAdminAmount] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminMessage, setAdminMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Sound toggler wrapper
  const handleToggleMute = () => {
    const muted = gameAudio.toggleMute();
    setIsMuted(muted);
  };

  // Helper to calculate daily claim countdown
  const updateClaimCooldown = (lastClaimStr: string | null) => {
    if (!lastClaimStr) {
      setClaimCooldown(null);
      return;
    }
    const lastClaim = new Date(lastClaimStr);
    const now = new Date();
    const cooldownMs = 24 * 60 * 60 * 1000;
    const timePassed = now.getTime() - lastClaim.getTime();

    if (timePassed < cooldownMs) {
      const remainingMs = cooldownMs - timePassed;
      const hours = Math.floor(remainingMs / (60 * 60 * 1000));
      const mins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
      setClaimCooldown(`${hours}h ${mins}m`);
    } else {
      setClaimCooldown(null);
    }
  };

  // 1. Check Auth & Load Profile
  const fetchProfileData = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/");
        return;
      }
      setSessionToken(session.access_token);

      const { data: prof, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      if (error) throw error;
      setProfile(prof);

      // Check daily claim cooldown
      updateClaimCooldown(prof.last_daily_claim);
    } catch (err) {
      console.error("Error loading profile:", err);
    } finally {
      setLoadingProfile(false);
    }
  }, [router]);

  // Fetch social details (Leaderboard & Feed)
  const fetchSocialData = useCallback(async () => {
    try {
      // 1. Leaderboard: top 10 profiles by balance
      const { data: topProfiles } = await supabase
        .from("profiles")
        .select("id, username, balance, last_daily_claim, is_admin")
        .order("balance", { ascending: false })
        .limit(10);

      if (topProfiles) setLeaderboard(topProfiles);

      // 2. Recent Big Wins: spins where win > 0 and multiplier >= 5x, or features
      const { data: bigSpins } = await supabase
        .from("spins")
        .select("id, username, bet_amount, win_amount, multiplier, is_feature_trigger, created_at")
        .order("created_at", { ascending: false })
        .limit(10);

      if (bigSpins) setRecentSpins(bigSpins);
    } catch (err) {
      console.error("Social load error:", err);
    }
  }, []);

  // Initial load & Polling
  useEffect(() => {
    const init = async () => {
      await fetchProfileData();
      await fetchSocialData();
    };
    init();

    // Poll leaderboard and big wins every 8 seconds for a lively environment
    const interval = setInterval(() => {
      fetchSocialData();
    }, 8000);

    return () => clearInterval(interval);
  }, [fetchProfileData, fetchSocialData]);

  // 2. Daily Chips Claim handler
  const handleClaimReward = async () => {
    if (!sessionToken) return;
    setClaimMessage(null);

    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        }
      });
      const data = await res.json();

      if (!res.ok) {
        setClaimMessage({ text: data.error, type: "error" });
      } else {
        setClaimMessage({ text: `Sucesso! +5.000 CKBucks resgatados.`, type: "success" });
        // Update local profile balance and timer
        setProfile(prev => prev ? { ...prev, balance: data.newBalance, last_daily_claim: new Date().toISOString() } : null);
        setClaimCooldown("23h 59m");
        gameAudio.playWin();
        confetti({ particleCount: 60, spread: 40, origin: { y: 0.8 } });
      }
    } catch (err) {
      console.error("Claim error:", err);
      setClaimMessage({ text: "Falha na conexão. Tente novamente.", type: "error" });
    }
  };

  // Admin balance adjustment handler
  const handleAdminAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionToken || adminLoading) return;
    setAdminMessage(null);

    const amountNum = parseFloat(adminAmount);
    if (isNaN(amountNum) || amountNum === 0) {
      setAdminMessage({ text: "Insira um valor numérico diferente de zero.", type: "error" });
      return;
    }

    if (!adminTargetUsername.trim()) {
      setAdminMessage({ text: "Insira o apelido do amigo.", type: "error" });
      return;
    }

    setAdminLoading(true);

    try {
      const res = await fetch("/api/admin/adjust-balance", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          targetUsername: adminTargetUsername.trim(),
          amount: amountNum
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setAdminMessage({ text: data.error || "Erro ao ajustar saldo.", type: "error" });
      } else {
        setAdminMessage({ text: `Ajuste feito! Novo saldo de ${data.targetUsername}: CKB$ ${formatBalance(data.newBalance)}`, type: "success" });
        setAdminTargetUsername("");
        setAdminAmount("");
        gameAudio.playWin();
        fetchProfileData();
        fetchSocialData();
      }
    } catch (err) {
      console.error("Admin adjust error:", err);
      setAdminMessage({ text: "Falha na conexão com o servidor.", type: "error" });
    } finally {
      setAdminLoading(false);
    }
  };

  // 3. Main Slot Spin Trigger
  const triggerSpin = async () => {
    if (spinning || !profile || !sessionToken) return;
    if (profile.balance < bet) {
      setClaimMessage({ text: "Saldo insuficiente! Resgate CKBucks diários na lateral.", type: "error" });
      setAutoSpins(0);
      return;
    }

    setClaimMessage(null);
    setWinLines([]);
    setSpinning(true);
    setTigerState("spin");
    gameAudio.playSpin();

    // Deduct bet amount visually from local profile immediately to feel responsive
    setProfile(prev => prev ? { ...prev, balance: prev.balance - bet } : null);

    // Staggered spinning animation indicators
    setActiveColumns([true, true, true]);

    try {
      // Fetch spin result from secure server endpoint
      // Development mode can force the Fortune Tiger Feature by setting forceFeature: true
      const forceFeature = false; // Set to true to test respins directly

      const res = await fetch("/api/spin", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ betAmount: bet, forceFeature })
      });

      if (!res.ok) {
        const errData = await res.json();
        setClaimMessage({ text: errData.error || "Erro ao girar.", type: "error" });
        // Return bet amount back to local profile
        setProfile(prev => prev ? { ...prev, balance: prev.balance + bet } : null);
        resetSpinState();
        return;
      }

      const data = await res.json();

      // Pre-set the grid immediately so that as columns stop, they show the new spin results
      if (data.isFeatureTrigger) {
        setGrid(data.featureRespins[0]);
      } else {
        setGrid(data.grid);
      }

      // Determine animation delays (constant smooth durations)
      const col1Delay = 1000;
      const col2Delay = 1500;
      const col3Delay = 2000;

      // Reel 1 stop
      setTimeout(() => {
        setActiveColumns([false, true, true]);
        gameAudio.playStop(0.9);
      }, col1Delay);

      // Reel 2 stop
      setTimeout(() => {
        setActiveColumns([false, false, true]);
        gameAudio.playStop(1.0);
      }, col2Delay);

      // Reel 3 stop
      setTimeout(async () => {
        setActiveColumns([false, false, false]);
        gameAudio.playStop(1.1);

        // Process final grid or start Fortune Tiger Respin Feature
        if (data.isFeatureTrigger) {
          await runFortuneTigerFeatureSequence(data);
        } else {
          // Standard spin end
          setSpinning(false);

          // Apply new balance from DB
          setProfile(prev => prev ? { ...prev, balance: data.newBalance } : null);

          if (data.totalWin > 0) {
            setWinLines(data.winLines);
            setTigerState("win");

            if (data.totalMultiplier >= 15 || data.isFullGridWin) {
              triggerBigWinCelebration(data.totalWin, data.totalMultiplier);
            } else {
              gameAudio.playWin();
            }
          } else {
            setTigerState("idle");
          }

          // Decrement auto spins if active
          handleAutoSpinsDecrement();
        }
      }, col3Delay);

    } catch (err) {
      console.error("Spin request failed:", err);
      setProfile(prev => prev ? { ...prev, balance: prev.balance + bet } : null);
      resetSpinState();
    }
  };

  // Helper to reset states when a spin crashes
  const resetSpinState = () => {
    setSpinning(false);
    setActiveColumns([false, false, false]);
    setTigerState("idle");
    setAutoSpins(0);
  };

  // Decrement auto spins and trigger next one if active
  const handleAutoSpinsDecrement = () => {
    if (autoSpinsRef.current > 0) {
      // If it is set to infinite (99999), do not decrement it.
      if (autoSpinsRef.current < 99999) {
        setAutoSpins(prev => prev - 1);
      }
      setTimeout(() => {
        if (autoSpinsRef.current > 0) {
          triggerSpin();
        }
      }, 1000);
    }
  };

  // 4. Fortune Tiger Feature (Sequential Locking Respin Animation)
  const runFortuneTigerFeatureSequence = async (data: SpinResultResponse) => {
    setInFeature(true);
    setTigerState("roar");
    gameAudio.playFeatureTrigger();
    setFeatureSymbol(data.featureSymbol || null);
    setFeatureTotalRounds(data.featureRespins!.length);

    // Initial grid state for respin round 0
    setGrid(data.featureRespins![0]);
    setFeatureRound(1);

    const respinSteps = data.featureRespins!;

    // Loop through each respin step sequentially with delays
    for (let i = 1; i < respinSteps.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 1600));

      setFeatureRound(i + 1);

      // Simulate brief respin flicker on un-locked (blank) spots
      setSpinning(true);
      gameAudio.playSpin();

      await new Promise(resolve => setTimeout(resolve, 800));

      setSpinning(false);
      setGrid(respinSteps[i]);
      gameAudio.playStop(1.0 + i * 0.05);
    }

    // End of feature
    await new Promise(resolve => setTimeout(resolve, 800));
    setInFeature(false);
    setFeatureSymbol(null);

    // Apply final profile balance
    setProfile(prev => prev ? { ...prev, balance: data.newBalance } : null);

    if (data.totalWin > 0) {
      setWinLines(data.winLines);
      setTigerState("win");

      if (data.totalMultiplier >= 15 || data.isFullGridWin) {
        triggerBigWinCelebration(data.totalWin, data.totalMultiplier);
      } else {
        gameAudio.playWin();
      }
    } else {
      setTigerState("idle");
    }

    // Keep auto spins running
    handleAutoSpinsDecrement();
  };

  // 5. Big Win Celebration Popup with confetti showers
  const triggerBigWinCelebration = (win: number, mult: number) => {
    setCelebrationWin(win);
    setCelebrationMultiplier(mult);
    setShowCelebration(true);
    gameAudio.playBigWin();

    // Trigger looping confetti showers
    const duration = 4000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ["#ffd700", "#ff3d00", "#ffffff"]
      });
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ["#ffd700", "#ff3d00", "#ffffff"]
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  };

  // Logout handler
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  // Format numbers to local currency/chip count (e.g., 10.000,00)
  const formatBalance = (val: number) => {
    return val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (loadingProfile) {
    return (
      <div style={styles.loaderContainer}>
        <Coins size={48} className="roaring-tiger" color="var(--bright-gold)" />
        <h3 className="gold-text" style={{ marginTop: "12px" }}>Acessando o Kassino...</h3>
      </div>
    );
  }

  return (
    <div className="dashboard-container" style={styles.dashboardContainer}>
      {/* Header bar */}
      <header className="nav-bar glass-panel" style={styles.navBar}>
        <div style={styles.navLeft}>
          <Coins size={24} color="var(--bright-gold)" />
          <h2 className="gold-text" style={{ fontSize: "1.4rem", margin: 0 }}>KASSINO CKB</h2>
        </div>

        {profile && (
          <div style={styles.navCenter} className="glass-panel">
            <span style={styles.navBalanceLabel}>SALDO</span>
            <span className="gold-text" style={styles.navBalanceValue}>
              CKB$ {formatBalance(profile.balance)}
            </span>
          </div>
        )}

        <div style={styles.navRight}>
          {profile && (
            <span style={styles.navUser}>
              Olá, <strong>{profile.username}</strong>
            </span>
          )}
          <button style={styles.iconBtn} onClick={() => router.push("/dashboard")} title="Voltar ao Lobby">
            <Home size={18} color="var(--bright-gold)" />
          </button>
          <button style={styles.iconBtn} onClick={handleToggleMute} title={isMuted ? "Desativar Mudo" : "Mudar Mudo"}>
            {isMuted ? <VolumeX size={18} color="#ef5350" /> : <Volume2 size={18} color="var(--bright-gold)" />}
          </button>
          <button style={{ ...styles.iconBtn, background: "rgba(239, 83, 80, 0.1)" }} onClick={handleLogout} title="Sair">
            <LogOut size={18} color="#ef5350" />
          </button>
        </div>
      </header>

      {/* Main Grid View */}
      <main className="dashboard-grid" style={styles.mainGrid}>

        {/* Left Side: Game Area */}
        <section style={styles.gameSection}>

          {/* Mascot frame */}
          <div style={styles.mascotArea}>
            <div style={styles.mascotBubble}>
              {tigerState === "idle" && "Boa sorte! Gira aí papai!!"}
              {tigerState === "spin" && "Acelerando! Roda roda roda!"}
              {tigerState === "win" && "INCRÍVEL! VITÓRIA DA FORTUNA!"}
              {tigerState === "roar" && "A FORTUNA DO TIGRE FOI ATIVADA! ROARRR!"}
            </div>

            <img
              src="/images/tiger_mascot.png"
              alt="Fortune Tiger Mascot"
              className={`mascot-img floating ${tigerState === "roar" ? "roaring-tiger" : ""}`}
              style={{
                width: "140px",
                height: "140px",
                objectFit: "contain",
                filter: tigerState === "roar" ? "drop-shadow(0 0 15px var(--bright-gold))" : "none",
                transition: "all 0.3s ease"
              }}
            />
          </div>

          {/* Slot Machine Shell */}
          <div className="slot-shell glass-panel" style={styles.slotShell}>
            {/* Feature Banner overlay */}
            {inFeature && (
              <div style={styles.featureHeader}>
                <Flame size={20} color="var(--bright-gold)" className="roaring-tiger" />
                <span className="gold-text" style={styles.featureHeaderText}>
                  RODADAS DA FORTUNA ({featureRound}/{featureTotalRounds})
                </span>
                <Flame size={20} color="var(--bright-gold)" className="roaring-tiger" />
              </div>
            )}

            {/* Symbols grid */}
            <div style={styles.gridFrame}>
              {/* Highlight winning paylines */}
              {winLines.length > 0 && (
                <div style={styles.winOverlay}>
                  {winLines.map((line, idx) => (
                    <div
                      key={idx}
                      style={{
                        ...styles.winLineDrawing,
                        borderColor: "var(--bright-gold)",
                        boxShadow: "0 0 10px var(--bright-gold)"
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Reels rendering */}
              <div style={styles.reelsContainer}>
                {[0, 1, 2].map((colIndex) => (
                  <div key={colIndex} style={styles.reelColumn}>
                    {/* Spinning visual wrapper */}
                    {activeColumns[colIndex] || (spinning && inFeature) ? (
                      <div className="spinning-column" style={styles.spinningColumnContent}>
                        {Object.values(SYMBOLS).map((sym, sIdx) => (
                          <div key={sIdx} style={styles.symbolCell}>
                            <img src={sym.image} alt={sym.name} style={styles.symbolImg} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      /* Static grid display */
                      <div style={styles.staticColumnContent}>
                        {[0, 1, 2].map((rowIndex) => {
                          const symId = grid[rowIndex][colIndex];
                          const isBlank = symId === BLANK_SYMBOL_ID;
                          const symbol = SYMBOLS[symId];

                          // Check if cell is part of the feature focus
                          const isFeatureTarget = inFeature && symbol?.id === featureSymbol;
                          const isWildLocked = inFeature && symbol?.id === "tiger_wild";

                          return (
                            <div
                              key={rowIndex}
                              style={{
                                ...styles.symbolCell,
                                opacity: inFeature && !isFeatureTarget && !isWildLocked && !isBlank ? 0.35 : 1,
                                filter: isFeatureTarget || isWildLocked ? "drop-shadow(0 0 8px var(--bright-gold))" : "none",
                                borderTop: isFeatureTarget || isWildLocked ? "2px solid var(--bright-gold)" : "none",
                                borderLeft: isFeatureTarget || isWildLocked ? "2px solid var(--bright-gold)" : "none",
                                borderRight: isFeatureTarget || isWildLocked ? "2px solid var(--bright-gold)" : "none",
                                borderBottom: isFeatureTarget || isWildLocked ? "2px solid var(--bright-gold)" : "1px solid rgba(255, 215, 0, 0.05)",
                                background: isFeatureTarget || isWildLocked ? "rgba(255, 215, 0, 0.08)" : "none",
                                transition: "all 0.2s ease"
                              }}
                            >
                              {!isBlank && symbol && (
                                <img src={symbol.image} alt={symbol.name} style={styles.symbolImg} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Game Stats Feed (Win values) */}
            <div style={styles.statPanel}>
              {winLines.length > 0 ? (
                <div style={styles.winBanner}>
                  <Sparkles size={20} color="var(--bright-gold)" />
                  <span className="gold-text" style={{ fontSize: "1.2rem", fontWeight: "800" }}>
                    GANHO TOTAL: CKB$ {formatBalance(winLines.reduce((s, l) => s + l.payout, 0) * (winLines[0].coords.length === 9 ? 10 : 1))}
                  </span>
                  <Sparkles size={20} color="var(--bright-gold)" />
                </div>
              ) : inFeature ? (
                <div style={styles.featureSymbolPrompt}>
                  <span>Símbolo da Fortuna: </span>
                  <strong className="gold-text">{SYMBOLS[featureSymbol || ""]?.name || "Tigre"}</strong>
                </div>
              ) : (
                <div style={styles.promptBanner}>
                  Defina a aposta e clique em JOGAR!
                </div>
              )}
            </div>

            {/* Bet and Spin Controls */}
            <div className="controls-grid" style={styles.controlsGrid}>
              <div style={styles.controlGroup}>
                <span style={styles.controlLabel}>APOSTA</span>
                <div style={styles.betSelector}>
                  <button
                    style={styles.adjustBetBtn}
                    onClick={() => setBet(b => Math.max(10, b - 50))}
                    disabled={spinning}
                  >
                    -
                  </button>
                  <select
                    value={bet}
                    onChange={(e) => setBet(Number(e.target.value))}
                    style={styles.betSelect}
                    disabled={spinning}
                  >
                    {betLevels.map(lvl => (
                      <option key={lvl} value={lvl}>CKB$ {lvl}</option>
                    ))}
                  </select>
                  <button
                    style={styles.adjustBetBtn}
                    onClick={() => setBet(b => Math.min(1000, b + 50))}
                    disabled={spinning}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Mode Selection */}
              <div style={styles.controlGroup}>
                <span style={styles.controlLabel}>AUTO GIRO</span>
                <div style={styles.configControls}>
                  <button
                    style={{
                      ...styles.toggleConfigBtn,
                      background: autoSpins > 0 ? "linear-gradient(135deg, #ffd700 0%, #c5a059 100%)" : "rgba(255,255,255,0.05)",
                      color: autoSpins > 0 ? "#300" : "var(--text-muted)",
                      borderColor: autoSpins > 0 ? "var(--bright-gold)" : "rgba(255,255,255,0.1)",
                      width: "100%"
                    }}
                    onClick={() => setAutoSpins(prev => {
                      if (prev === 0) return 10;
                      if (prev === 10) return 30;
                      if (prev === 30) return 50;
                      if (prev === 50) return 100;
                      if (prev === 100) return 99999; // 99999 represents infinite (∞)
                      return 0; // Turn off
                    })}
                  >
                    {autoSpins === 99999 ? "AUTO (∞)" : autoSpins > 0 ? `AUTO (${autoSpins})` : "AUTO"}
                  </button>
                </div>
              </div>

              {/* SPIN Button */}
              <button
                onClick={triggerSpin}
                disabled={spinning}
                className="btn-primary"
                style={styles.spinButton}
              >
                {spinning ? (
                  <span style={{ fontSize: "1.1rem" }}>GIRANDO...</span>
                ) : (
                  <>
                    <Flame size={24} color="#3d0000" />
                    <span style={{ fontSize: "1.2rem", fontWeight: "900" }}>JOGAR</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        {/* Right Side: Social Panels (Leaderboard, Big Wins, Claims) */}
        <section style={styles.socialSection}>

          {/* Admin Control Panel (Only visible to Super Admins) */}
          {profile?.is_admin && (
            <div style={styles.socialPanel} className="glass-panel">
              <div style={styles.panelTitle}>
                <Flame size={18} color="var(--bright-gold)" />
                <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Painel Admin (God Mode)</h3>
              </div>
              <div style={styles.claimBody}>
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "12px" }}>
                  Adicione ou remova moedas de qualquer amigo. Use valores negativos para tirar (ex: -500).
                </p>
                <form onSubmit={handleAdminAdjustment} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <input
                    type="text"
                    placeholder="Apelido do amigo"
                    value={adminTargetUsername}
                    onChange={(e) => setAdminTargetUsername(e.target.value)}
                    required
                    className="form-input"
                    style={{ fontSize: "0.85rem", padding: "10px" }}
                    disabled={adminLoading}
                  />
                  <input
                    type="number"
                    placeholder="Quantidade de moedas"
                    value={adminAmount}
                    onChange={(e) => setAdminAmount(e.target.value)}
                    required
                    className="form-input"
                    style={{ fontSize: "0.85rem", padding: "10px" }}
                    disabled={adminLoading}
                  />
                  <button className="btn-primary" type="submit" style={{ width: "100%", padding: "10px" }} disabled={adminLoading}>
                    {adminLoading ? "Ajustando..." : "Aplicar Ajuste"}
                  </button>
                </form>

                {adminMessage && (
                  <div style={{
                    ...styles.claimMsgAlert,
                    background: adminMessage.type === "success" ? "rgba(76, 175, 80, 0.15)" : "rgba(211, 47, 47, 0.15)",
                    borderColor: adminMessage.type === "success" ? "rgba(76, 175, 80, 0.3)" : "rgba(211, 47, 47, 0.3)",
                    color: adminMessage.type === "success" ? "#c8e6c9" : "#ffcdd2"
                  }}>
                    {adminMessage.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    <span>{adminMessage.text}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Daily reward Claim panel */}
          <div style={styles.socialPanel} className="glass-panel">
            <div style={styles.panelTitle}>
              <Calendar size={18} color="var(--bright-gold)" />
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Recarga de CKBucks</h3>
            </div>
            <div style={styles.claimBody}>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "12px" }}>
                Ficou sem CKBucks ou quer aumentar seu saldo? Resgate grátis 5.000 CKBucks a cada 24 horas.
              </p>

              {claimCooldown ? (
                <div style={styles.cooldownContainer}>
                  <RotateCcw size={16} color="var(--text-muted)" />
                  <span>Disponível em: <strong>{claimCooldown}</strong></span>
                </div>
              ) : (
                <button className="btn-primary" onClick={handleClaimReward} style={{ width: "100%" }}>
                  <Sparkles size={16} /> Resgatar CKB$ 5.000
                </button>
              )}

              {claimMessage && (
                <div style={{
                  ...styles.claimMsgAlert,
                  background: claimMessage.type === "success" ? "rgba(76, 175, 80, 0.15)" : "rgba(211, 47, 47, 0.15)",
                  borderColor: claimMessage.type === "success" ? "rgba(76, 175, 80, 0.3)" : "rgba(211, 47, 47, 0.3)",
                  color: claimMessage.type === "success" ? "#c8e6c9" : "#ffcdd2"
                }}>
                  {claimMessage.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                  <span>{claimMessage.text}</span>
                </div>
              )}
            </div>
          </div>

          {/* Leaderboard Panel */}
          <div style={styles.socialPanel} className="glass-panel">
            <div style={styles.panelTitle}>
              <Crown size={18} color="var(--bright-gold)" />
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Ranking da Galera</h3>
            </div>

            <div style={styles.socialList}>
              {leaderboard.length === 0 ? (
                <div style={styles.emptyList}>Carregando ranking...</div>
              ) : (
                leaderboard.map((item, idx) => {
                  const isSelf = profile?.id === item.id;
                  return (
                    <div
                      key={item.id}
                      style={{
                        ...styles.leaderboardRow,
                        background: isSelf ? "rgba(255, 215, 0, 0.06)" : "none",
                        borderColor: isSelf ? "var(--bg-card-border)" : "transparent"
                      }}
                    >
                      <div style={styles.leaderboardRank}>
                        {idx === 0 && <Crown size={16} color="var(--bright-gold)" />}
                        {idx > 0 && <span style={{ color: "var(--text-muted)" }}>#{idx + 1}</span>}
                      </div>
                      <span style={{
                        fontWeight: isSelf ? "700" : "500",
                        color: isSelf ? "var(--bright-gold)" : "white"
                      }}>
                        {item.username}
                      </span>
                      <span style={styles.leaderboardValue}>
                        CKB$ {item.balance.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Recent Big Wins panel */}
          <div style={styles.socialPanel} className="glass-panel">
            <div style={styles.panelTitle}>
              <History size={18} color="var(--bright-gold)" />
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Últimos Resultados</h3>
            </div>

            <div style={styles.socialList}>
              {recentSpins.length === 0 ? (
                <div style={styles.emptyList}>Nenhuma jogada recente logada.</div>
              ) : (
                recentSpins.map((spin) => (
                  <div key={spin.id} style={styles.historyRow}>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "0.88rem", fontWeight: "600" }}>{spin.username}</span>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                        Aposta: CKB$ {spin.bet_amount}
                      </span>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      {spin.win_amount > 0 ? (
                        <span style={{
                          color: "var(--bright-gold)",
                          fontWeight: "700",
                          fontSize: "0.9rem"
                        }}>
                          +CKB$ {spin.win_amount.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} ({spin.multiplier}x)
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Sem ganho</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

      </main>

      {/* 6. Celebration Big Win Overlay Modal */}
      {showCelebration && (
        <div className="celebration-overlay" onClick={() => setShowCelebration(false)}>
          <div className="big-win-content" style={styles.celebrationModal}>
            <Flame size={64} color="var(--bright-gold)" className="roaring-tiger" />
            <h1 className="gold-text" style={styles.celebrationTitle}>GRANDE GANHO!</h1>
            <p style={styles.celebrationSub}>O TIGRE ABENÇOOU SUA JOGADA</p>

            <div style={styles.celebrationBadge}>
              <span style={{ fontSize: "1.2rem", color: "var(--text-muted)" }}>MULTIPLICADOR</span>
              <h2 className="gold-text" style={{ fontSize: "3rem", margin: 0 }}>{celebrationMultiplier}X</h2>
            </div>

            <h2 className="gold-text" style={{ fontSize: "2.8rem", marginTop: "12px" }}>
              +CKB$ {formatBalance(celebrationWin)}
            </h2>

            <button
              className="btn-primary"
              onClick={() => setShowCelebration(false)}
              style={{ marginTop: "24px", padding: "12px 36px" }}
            >
              COLETAR CKBUCKS
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Layout css configurations.
const styles: Record<string, React.CSSProperties> = {
  loaderContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    background: "var(--bg-dark)",
  },
  dashboardContainer: {
    padding: "24px",
    maxWidth: "1200px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    minHeight: "100vh",
  },
  navBar: {
    padding: "14px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "12px",
  },
  navLeft: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  navCenter: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 18px",
    background: "rgba(0, 0, 0, 0.4)",
    borderColor: "rgba(255, 215, 0, 0.3)",
    borderRadius: "20px",
  },
  navBalanceLabel: {
    fontSize: "0.75rem",
    fontWeight: "700",
    color: "var(--text-muted)",
    letterSpacing: "0.5px",
  },
  navBalanceValue: {
    fontSize: "1.2rem",
    fontWeight: "800",
  },
  navRight: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  navUser: {
    fontSize: "0.95rem",
    color: "var(--text-light)",
    marginRight: "8px",
  },
  iconBtn: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s ease",
  },
  mainGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 340px",
    gap: "24px",
    alignItems: "start",
  },
  gameSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
  },
  mascotArea: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    position: "relative",
  },
  mascotBubble: {
    background: "rgba(255, 255, 255, 0.95)",
    color: "rgba(10,0,0,0.9)",
    borderRadius: "14px",
    padding: "10px 14px",
    fontSize: "0.85rem",
    fontWeight: "600",
    maxWidth: "240px",
    textAlign: "center",
    boxShadow: "0 4px 15px rgba(0,0,0,0.2)",
    position: "relative",
    marginBottom: "4px",
  },
  slotShell: {
    width: "100%",
    maxWidth: "480px",
    padding: "24px",
    borderColor: "rgba(255, 215, 0, 0.45)",
    background: "linear-gradient(180deg, rgba(80,10,10,0.85) 0%, rgba(30,5,5,0.9) 100%)",
    boxShadow: "0 10px 40px rgba(0,0,0,0.6), 0 0 30px rgba(127, 0, 0, 0.3)",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    position: "relative",
  },
  featureHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "6px 12px",
    background: "linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.15), transparent)",
  },
  featureHeaderText: {
    fontSize: "0.95rem",
    fontWeight: "900",
    letterSpacing: "1px",
  },
  gridFrame: {
    width: "100%",
    aspectRatio: "1",
    background: "rgba(10, 0, 0, 0.8)",
    border: "4px solid var(--bright-gold)",
    borderRadius: "12px",
    boxShadow: "inset 0 0 20px rgba(0,0,0,0.9), 0 0 15px rgba(255, 215, 0, 0.25)",
    overflow: "hidden",
    position: "relative",
  },
  winOverlay: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 5,
  },
  winLineDrawing: {
    position: "absolute",
    inset: "4%",
    border: "3px solid transparent",
    borderRadius: "8px",
    animation: "fadeIn 0.2s linear infinite alternate",
  },
  reelsContainer: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    height: "100%",
    width: "100%",
  },
  reelColumn: {
    height: "100%",
    borderRight: "1px solid rgba(255, 215, 0, 0.15)",
    overflow: "hidden",
    position: "relative",
    display: "flex",
    flexDirection: "column",
  },
  spinningColumnContent: {
    display: "flex",
    flexDirection: "column",
    position: "absolute",
    width: "100%",
  },
  staticColumnContent: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  symbolCell: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px",
    background: "rgba(20, 5, 5, 0.4)",
    borderBottom: "1px solid rgba(255, 215, 0, 0.05)",
  },
  symbolImg: {
    width: "80%",
    height: "80%",
    objectFit: "contain",
  },
  statPanel: {
    background: "rgba(0,0,0,0.4)",
    borderRadius: "10px",
    padding: "10px",
    textAlign: "center",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "44px",
  },
  winBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
  },
  featureSymbolPrompt: {
    fontSize: "0.92rem",
    color: "var(--text-light)",
  },
  promptBanner: {
    fontSize: "0.85rem",
    color: "var(--text-muted)",
  },
  controlsGrid: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1.2fr 1fr",
    gap: "12px",
    alignItems: "end",
  },
  controlGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  controlLabel: {
    fontSize: "0.72rem",
    fontWeight: "700",
    color: "var(--text-muted)",
    letterSpacing: "0.5px",
    textTransform: "uppercase",
  },
  betSelector: {
    display: "flex",
    alignItems: "center",
    background: "rgba(0,0,0,0.4)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    overflow: "hidden",
  },
  adjustBetBtn: {
    width: "28px",
    height: "36px",
    background: "none",
    border: "none",
    color: "white",
    fontSize: "1.1rem",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  betSelect: {
    flex: 1,
    height: "36px",
    background: "none",
    border: "none",
    color: "var(--bright-gold)",
    fontSize: "0.85rem",
    fontWeight: "700",
    textAlign: "center",
    outline: "none",
    cursor: "pointer",
  },
  configControls: {
    display: "flex",
    gap: "6px",
  },
  toggleConfigBtn: {
    flex: 1,
    height: "38px",
    border: "1px solid",
    borderRadius: "8px",
    fontSize: "0.7rem",
    fontWeight: "800",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  spinButton: {
    height: "44px",
    borderRadius: "10px",
  },
  socialSection: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  socialPanel: {
    padding: "16px",
  },
  panelTitle: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    paddingBottom: "10px",
    marginBottom: "12px",
  },
  claimBody: {
    display: "flex",
    flexDirection: "column",
  },
  cooldownContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "10px",
    background: "rgba(0,0,0,0.3)",
    borderRadius: "10px",
    fontSize: "0.88rem",
    color: "var(--text-muted)",
  },
  claimMsgAlert: {
    marginTop: "10px",
    padding: "10px",
    borderRadius: "8px",
    border: "1px solid",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "0.78rem",
  },
  socialList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    maxHeight: "260px",
    overflowY: "auto",
  },
  emptyList: {
    padding: "20px 0",
    textAlign: "center",
    fontSize: "0.82rem",
    color: "var(--text-muted)",
  },
  leaderboardRow: {
    display: "flex",
    alignItems: "center",
    padding: "8px 10px",
    border: "1px solid transparent",
    borderRadius: "8px",
    fontSize: "0.88rem",
  },
  leaderboardRank: {
    width: "32px",
    display: "flex",
    alignItems: "center",
  },
  leaderboardValue: {
    marginLeft: "auto",
    fontWeight: "700",
    color: "var(--bright-gold)",
  },
  historyRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 10px",
    background: "rgba(0,0,0,0.15)",
    borderRadius: "8px",
    fontSize: "0.82rem",
  },
  celebrationModal: {
    background: "linear-gradient(180deg, rgba(127, 0, 0, 0.95) 0%, rgba(30, 5, 5, 0.98) 100%)",
    border: "3px solid var(--bright-gold)",
    boxShadow: "0 0 30px var(--bright-gold)",
    borderRadius: "24px",
    padding: "48px 32px",
    maxWidth: "460px",
    width: "90%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  celebrationTitle: {
    fontSize: "3.2rem",
    fontWeight: "900",
    margin: "12px 0 0 0",
    textAlign: "center",
    lineHeight: "1.1",
  },
  celebrationSub: {
    fontSize: "0.85rem",
    fontWeight: "700",
    letterSpacing: "2px",
    color: "var(--text-muted)",
    marginBottom: "24px",
  },
  celebrationBadge: {
    background: "rgba(0, 0, 0, 0.4)",
    border: "1px solid rgba(255, 215, 0, 0.25)",
    padding: "16px 32px",
    borderRadius: "16px",
    textAlign: "center",
    width: "100%",
    marginBottom: "16px",
  },
};
