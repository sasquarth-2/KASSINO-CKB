// Aviãozinho Crash Game Page - Central Lobby Integration (KASSINO-CKB)
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import { gameAudio } from "@/lib/audio-manager";
import { 
  Volume2, VolumeX, LogOut, Coins, Crown, Flame, 
  Calendar, RotateCcw, AlertCircle, Sparkles, CheckCircle2, Home, Users
} from "lucide-react";
import confetti from "canvas-confetti";

interface Profile {
  id: string;
  username: string;
  balance: number;
  last_daily_claim: string | null;
  is_admin: boolean;
}

interface CrashRoundHistory {
  id: string;
  multiplier: number;
  crashedAt: number;
}

interface FriendBet {
  username: string;
  betAmount: number;
  cashoutMultiplier: number | null;
  status: "waiting" | "betting" | "cashed_out" | "crashed";
}

export default function Aviaozinho() {
  const router = useRouter();

  // Auth & Profile state
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Leaderboard state
  const [leaderboard, setLeaderboard] = useState<Profile[]>([]);
  
  // Daily claim timers
  const [claimCooldown, setClaimCooldown] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Admin Panel states
  const [adminTargetUsername, setAdminTargetUsername] = useState("");
  const [adminAmount, setAdminAmount] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminMessage, setAdminMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Crash Game Loop States
  const [gameStatus, setGameStatus] = useState<"betting" | "flying" | "crashed">("betting");
  const [countdown, setCountdown] = useState<number>(5.0);
  const [currentMultiplier, setCurrentMultiplier] = useState<number>(1.00);
  const [crashPoint, setCrashPoint] = useState<number>(1.00);
  const [recentMultipliers, setRecentMultipliers] = useState<CrashRoundHistory[]>([]);
  
  // User Betting States
  const [betInput, setBetInput] = useState<string>("100");
  const [hasBet, setHasBet] = useState<boolean>(false);
  const [activeBetAmount, setActiveBetAmount] = useState<number>(0);
  const [isCashedOut, setIsCashedOut] = useState<boolean>(false);
  const [wonAmount, setWonAmount] = useState<number>(0);

  // Security variables received from secure API bet placement
  const [betTimestamp, setBetTimestamp] = useState<string>("");
  const [betSignature, setBetSignature] = useState<string>("");
  const [isApiLoading, setIsApiLoading] = useState<boolean>(false);

  // Multiplayer Lobby Simulation States
  const [friendBets, setFriendBets] = useState<FriendBet[]>([]);

  // Canvas Reference
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const planeImageRef = useRef<HTMLImageElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Sound Toggles
  const handleToggleMute = () => {
    const muted = gameAudio.toggleMute();
    setIsMuted(muted);
  };

  // Load aviaozinho image helper
  useEffect(() => {
    const img = new Image();
    img.src = "/images/aviaozinho.png";
    planeImageRef.current = img;
  }, []);

  // Fetch recent crash rounds from spins table
  const fetchCrashHistory = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("spins")
        .select("id, multiplier, symbols")
        .order("created_at", { ascending: false })
        .limit(30);

      if (data) {
        // Filter rows that are crash games
        const crashGames = data
          .filter(s => Array.isArray(s.symbols) && s.symbols[0] === "crash")
          .map(s => ({
            id: s.id,
            // The crash point is stored as the third element of symbols
            crashedAt: parseFloat(s.symbols[2] || "0"),
            // User cashout multiplier (or 0 if crashed)
            multiplier: parseFloat(s.multiplier.toString())
          }))
          .slice(0, 10);
        
        setRecentMultipliers(crashGames);
      }
    } catch (err) {
      console.error("Error loading crash history:", err);
    }
  }, []);

  // Check claim cooldown time helper
  const updateClaimCooldown = (lastClaimStr: string | null) => {
    if (!lastClaimStr) {
      setClaimCooldown(null);
      return;
    }
    const lastClaim = new Date(lastClaimStr).getTime();
    const now = new Date().getTime();
    const cooldownMs = 24 * 60 * 60 * 1000;
    
    if (now - lastClaim < cooldownMs) {
      const remainingMs = cooldownMs - (now - lastClaim);
      const hours = Math.floor(remainingMs / (1000 * 60 * 60));
      const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
      setClaimCooldown(`${hours}h ${minutes}m`);
    } else {
      setClaimCooldown(null);
    }
  };

  // Load profile
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
      updateClaimCooldown(prof.last_daily_claim);
    } catch (err) {
      console.error("Error loading profile:", err);
    } finally {
      setLoadingProfile(false);
    }
  }, [router]);

  // Load Leaderboard
  const fetchSocialData = useCallback(async () => {
    try {
      const { data: topProfiles } = await supabase
        .from("profiles")
        .select("id, username, balance, last_daily_claim, is_admin")
        .order("balance", { ascending: false })
        .limit(10);

      if (topProfiles) setLeaderboard(topProfiles);
    } catch (err) {
      console.error("Social load error:", err);
    }
  }, []);

  // 1. Initial Load & Polling
  useEffect(() => {
    const init = async () => {
      await fetchProfileData();
      await fetchSocialData();
      await fetchCrashHistory();
    };
    init();

    const interval = setInterval(() => {
      fetchSocialData();
    }, 8000);

    return () => clearInterval(interval);
  }, [fetchProfileData, fetchSocialData, fetchCrashHistory]);

  // Daily claim
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
        setProfile(prev => prev ? { ...prev, balance: data.newBalance, last_daily_claim: new Date().toISOString() } : null);
        setClaimCooldown("23h 59m");
        gameAudio.playWin();
        confetti({ particleCount: 60, spread: 40, origin: { y: 0.8 } });
        fetchSocialData();
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

  // Formats
  const formatBalance = (val: number) => {
    return val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  // ==========================================================================
  // 🎮 CRASH GAME STATE MACHINE LOOP
  // ==========================================================================
  
  // 1. Betting Phase timer countdown
  useEffect(() => {
    if (gameStatus !== "betting") return;

    // Reset game parameters for new round
    setCurrentMultiplier(1.00);
    setIsCashedOut(false);
    setWonAmount(0);

    // Generate simulated bets of other friends from leaderboard
    const simulateFriendsBets = () => {
      if (leaderboard.length === 0) return;
      const count = 2 + Math.floor(Math.random() * 4); // 2 to 5 friends
      const shuffled = [...leaderboard].sort(() => 0.5 - Math.random());
      
      const newBets: FriendBet[] = shuffled.slice(0, count).map(friend => {
        const betAmount = [10, 20, 50, 100, 200, 500, 1000][Math.floor(Math.random() * 7)];
        // Determine a target multiplier where they want to cashout (sometimes high, sometimes low)
        const targetMultiplier = 1.1 + Math.random() * 5.0;
        
        return {
          username: friend.username,
          betAmount,
          cashoutMultiplier: parseFloat(targetMultiplier.toFixed(2)),
          status: "betting"
        };
      });

      setFriendBets(newBets);
    };
    simulateFriendsBets();

    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 0.1) {
          clearInterval(interval);
          // Transition to flight phase
          setGameStatus("flying");
          return 0;
        }
        return parseFloat((prev - 0.1).toFixed(1));
      });
    }, 100);

    return () => clearInterval(interval);
  }, [gameStatus, leaderboard]);

  // 2. Flight Phase game ticks
  useEffect(() => {
    if (gameStatus !== "flying") return;

    // Start plane engine sound
    gameAudio.playSpin(); 

    const startTime = Date.now();
    
    const tick = () => {
      const elapsedSec = (Date.now() - startTime) / 1000;
      
      // Multiplier grows exponentially over time
      const multVal = parseFloat((1.00 + Math.pow(elapsedSec / 8, 2.2)).toFixed(2));
      setCurrentMultiplier(multVal);

      // Check if plane crashed for the player
      // If user has an active bet, we stop when they hit the crashPoint
      const currentLimit = hasBet ? crashPoint : 10.0 + Math.random() * 15.0; // decorative end if no bet
      
      // Update simulated friends status in real-time
      setFriendBets(prevBets => 
        prevBets.map(bet => {
          if (bet.status === "betting" && bet.cashoutMultiplier && multVal >= bet.cashoutMultiplier) {
            // Friend cashes out!
            if (bet.cashoutMultiplier <= currentLimit) {
              return { ...bet, status: "cashed_out" };
            }
          }
          if (multVal >= currentLimit && bet.status === "betting") {
            // Friend crashed
            return { ...bet, status: "crashed" };
          }
          return bet;
        })
      );

      if (multVal >= currentLimit) {
        // Plane crashed!
        setGameStatus("crashed");
        gameAudio.playStop(0.85); // crash explosion sound
        
        // If user was betting and didn't cashout, they lost
        if (hasBet && !isCashedOut) {
          setHasBet(false);
        }
        
        // Add to history list
        setRecentMultipliers(prev => [
          { id: Math.random().toString(), multiplier: 0, crashedAt: currentLimit },
          ...prev.slice(0, 9)
        ]);

        // Start countdown to next round after 3 seconds
        setTimeout(() => {
          setCountdown(5.0);
          setGameStatus("betting");
        }, 3000);

        return;
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [gameStatus, hasBet, crashPoint, isCashedOut]);

  // ==========================================================================
  // 🎨 CANVAS ANIMATION RENDERING LOOP
  // ==========================================================================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = canvas.width = canvas.parentElement?.clientWidth || 500;
    let height = canvas.height = 360;

    // Resize handler
    const handleResize = () => {
      if (canvas && canvas.parentElement) {
        width = canvas.width = canvas.parentElement.clientWidth;
      }
    };
    window.addEventListener("resize", handleResize);

    // Stars background simulation
    const stars = Array(40).fill(null).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 1 + Math.random() * 2,
      speed: 0.5 + Math.random() * 1.5
    }));

    let animFrame: number;
    let time = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      time += 0.05;

      // Draw Grid System
      ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
      ctx.lineWidth = 1;
      const gridSize = 40;
      
      // Moving grid logic during flight
      const offset = gameStatus === "flying" ? (time * 15) % gridSize : 0;
      
      for (let x = offset; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = height - offset; y > 0; y -= gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw Stars/Sparks moving left
      ctx.fillStyle = "rgba(255, 215, 0, 0.4)";
      stars.forEach(star => {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();

        if (gameStatus === "flying") {
          star.x -= star.speed * (currentMultiplier * 1.2);
          if (star.x < 0) {
            star.x = width;
            star.y = Math.random() * height;
          }
        }
      });

      // Bottom-left origin point (Ground)
      const originX = 50;
      const originY = height - 50;

      if (gameStatus === "betting") {
        // Plane warming up on the ground
        const planeX = originX + Math.sin(time * 5) * 2;
        const planeY = originY + Math.cos(time * 8) * 1.5;
        
        // Draw decorative runway
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(10, originY + 15);
        ctx.lineTo(120, originY + 15);
        ctx.stroke();

        // Draw plane
        if (planeImageRef.current && planeImageRef.current.complete) {
          ctx.drawImage(planeImageRef.current, planeX - 25, planeY - 35, 60, 50);
        } else {
          ctx.fillStyle = "#ffd700";
          ctx.fillRect(planeX - 15, planeY - 15, 30, 30);
        }

      } else if (gameStatus === "flying" || gameStatus === "crashed") {
        // Calculate curve path
        // Plane moves along a Bezier path towards the top-right
        // Maximum multiplier of visual curve capped at 10x for graphing
        const maxVal = Math.min(10.0, currentMultiplier);
        const progress = (maxVal - 1.0) / 9.0; // 0 to 1

        const endX = originX + (width - 120) * Math.min(1.0, progress * 1.5 + 0.1);
        const endY = originY - (height - 120) * Math.min(1.0, Math.pow(progress, 0.7) * 1.1 + 0.1);

        // Control point for curve
        const cpX = originX + (endX - originX) * 0.5;
        const cpY = originY;

        // Draw flight path curve line
        const gradient = ctx.createLinearGradient(originX, originY, endX, endY);
        gradient.addColorStop(0, "rgba(211, 47, 47, 0.3)");
        gradient.addColorStop(1, "#ffd700");

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 4;
        ctx.shadowColor = "rgba(255, 215, 0, 0.3)";
        ctx.shadowBlur = 10;
        
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.quadraticCurveTo(cpX, cpY, endX, endY);
        ctx.stroke();
        
        // Reset shadow
        ctx.shadowBlur = 0;

        // Draw trailing smoke particles
        ctx.fillStyle = "rgba(255, 215, 0, 0.15)";
        for (let i = 0; i < 5; i++) {
          const smokeOffset = (time * 2 + i) % 5;
          // Interpolate point along curve for smoke position
          const tVal = Math.max(0, 1 - smokeOffset * 0.1);
          const sX = (1-tVal)*(1-tVal)*originX + 2*(1-tVal)*tVal*cpX + tVal*tVal*endX;
          const sY = (1-tVal)*(1-tVal)*originY + 2*(1-tVal)*tVal*cpY + tVal*tVal*endY;
          
          ctx.beginPath();
          ctx.arc(sX - 10, sY + 5 + Math.sin(time + i)*3, 8 - smokeOffset * 1.2, 0, Math.PI * 2);
          ctx.fill();
        }

        if (gameStatus === "flying") {
          // Shaking plane during flight
          const shakeX = Math.sin(time * 12) * 2;
          const shakeY = Math.cos(time * 10) * 2;

          if (planeImageRef.current && planeImageRef.current.complete) {
            ctx.drawImage(planeImageRef.current, endX - 30 + shakeX, endY - 30 + shakeY, 70, 55);
          } else {
            ctx.fillStyle = "#ffd700";
            ctx.fillRect(endX - 15, endY - 15, 30, 30);
          }
        } else if (gameStatus === "crashed") {
          // Plane flies away quickly into space
          const flyAwayTime = time % 10;
          const fx = endX + flyAwayTime * 30;
          const fy = endY - flyAwayTime * 20;

          // Draw smaller fading plane
          ctx.globalAlpha = Math.max(0, 1 - flyAwayTime * 0.25);
          if (planeImageRef.current && planeImageRef.current.complete) {
            ctx.drawImage(planeImageRef.current, fx - 20, fy - 20, 50, 40);
          }
          ctx.globalAlpha = 1.0;

          // Draw small explosion spark at crash site
          if (flyAwayTime < 1.0) {
            ctx.fillStyle = "#ff3d00";
            ctx.beginPath();
            ctx.arc(endX, endY, 20 * flyAwayTime, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#ffd700";
            ctx.beginPath();
            ctx.arc(endX, endY, 10 * flyAwayTime, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      animFrame = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animFrame);
    };
  }, [gameStatus, currentMultiplier]);

  // ==========================================================================
  // 💸 SECURE BET & CASHOUT LOGIC (API Calls)
  // ==========================================================================

  // 1. Places the bet for the current round
  const handlePlaceBet = async () => {
    if (!sessionToken || isApiLoading || hasBet) return;
    setClaimMessage(null);

    const betAmountNum = parseFloat(betInput);
    if (isNaN(betAmountNum) || betAmountNum < 10 || betAmountNum > 10000) {
      setClaimMessage({ text: "Insira uma aposta entre CKB$ 10 e CKB$ 10.000", type: "error" });
      return;
    }

    if (profile && profile.balance < betAmountNum) {
      setClaimMessage({ text: "Saldo insuficiente! Recarregue na lateral.", type: "error" });
      return;
    }

    setIsApiLoading(true);

    try {
      const res = await fetch("/api/crash/bet", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ betAmount: betAmountNum })
      });
      const data = await res.json();

      if (!res.ok) {
        setClaimMessage({ text: data.error || "Erro ao fazer aposta.", type: "error" });
      } else {
        // Success
        setHasBet(true);
        setActiveBetAmount(betAmountNum);
        setCrashPoint(data.crashPoint);
        setBetTimestamp(data.timestamp);
        setBetSignature(data.signature);
        setIsCashedOut(false);
        setWonAmount(0);

        // Deduct balance locally
        setProfile(prev => prev ? { ...prev, balance: data.newBalance } : null);
        gameAudio.playWin();
      }
    } catch (err) {
      console.error("Crash bet request error:", err);
      setClaimMessage({ text: "Erro de conexão com o servidor.", type: "error" });
    } finally {
      setIsApiLoading(false);
    }
  };

  // 2. Process Cashout
  const handleCashOut = async () => {
    if (!sessionToken || isApiLoading || !hasBet || isCashedOut || gameStatus !== "flying") return;

    setIsApiLoading(true);
    const cashoutVal = currentMultiplier;

    try {
      const res = await fetch("/api/crash/cashout", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          betAmount: activeBetAmount,
          cashoutMultiplier: cashoutVal,
          crashPoint: crashPoint,
          timestamp: betTimestamp,
          signature: betSignature
        })
      });
      const data = await res.json();

      if (!res.ok) {
        // Cashout failed (probably crashed at that exact millisecond)
        setClaimMessage({ text: data.error || "Erro ao realizar Cash Out.", type: "error" });
        setHasBet(false);
        setIsCashedOut(false);
      } else {
        // Cashout success!
        setIsCashedOut(true);
        setWonAmount(data.winAmount);
        setHasBet(false);

        // Update local profile balance
        setProfile(prev => prev ? { ...prev, balance: data.newBalance } : null);
        
        // Trigger chimes and confetti
        gameAudio.playWin();
        confetti({ particleCount: 30, spread: 30, origin: { y: 0.8 } });
        fetchSocialData();
        fetchCrashHistory();
      }
    } catch (err) {
      console.error("Cashout request error:", err);
      setClaimMessage({ text: "Falha na conexão ao retirar prêmio.", type: "error" });
    } finally {
      setIsApiLoading(false);
    }
  };

  if (loadingProfile) {
    return (
      <div style={styles.loaderContainer}>
        <Coins size={48} className="roaring-tiger" color="var(--bright-gold)" />
        <h3 className="gold-text" style={{ marginTop: "12px" }}>Conectando ao Aviãozinho...</h3>
      </div>
    );
  }

  return (
    <div className="dashboard-container" style={styles.dashboardContainer}>
      {/* Header HUD */}
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

      {/* Crash History Bar */}
      <div style={styles.historyBar} className="glass-panel">
        <span style={{ fontSize: "0.75rem", fontWeight: "800", color: "var(--text-muted)", marginRight: "8px" }}>HISTÓRICO:</span>
        <div style={styles.historyList}>
          {recentMultipliers.length === 0 ? (
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Aguardando rodadas finalizadas...</span>
          ) : (
            recentMultipliers.map((round) => (
              <span 
                key={round.id} 
                style={{
                  ...styles.historyBadge,
                  background: round.crashedAt >= 10.0 ? "linear-gradient(135deg, #ffd700 0%, #c5a059 100%)" :
                              round.crashedAt >= 2.0 ? "rgba(76, 175, 80, 0.18)" : "rgba(255, 255, 255, 0.05)",
                  color: round.crashedAt >= 10.0 ? "#300" :
                         round.crashedAt >= 2.0 ? "#81c784" : "var(--text-muted)",
                  borderColor: round.crashedAt >= 10.0 ? "var(--bright-gold)" :
                               round.crashedAt >= 2.0 ? "rgba(76, 175, 80, 0.3)" : "rgba(255,255,255,0.1)"
                }}
              >
                {round.crashedAt.toFixed(2)}x
              </span>
            ))
          )}
        </div>
      </div>

      {/* Main Grid: Game area on left, social columns on right */}
      <main className="dashboard-grid" style={styles.mainGrid}>
        
        {/* Left Side: Aviãozinho Main Area */}
        <section style={styles.gameSection}>
          
          {/* Flight Display Canvas */}
          <div style={styles.canvasContainer} className="glass-panel">
            <canvas ref={canvasRef} style={{ display: "block", borderRadius: "12px" }} />
            
            {/* Overlay Multiplier display */}
            <div style={styles.canvasOverlay}>
              {gameStatus === "betting" ? (
                <div style={styles.countdownBox}>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", letterSpacing: "1px" }}>PRÓXIMA RODADA EM</span>
                  <h1 style={{ fontSize: "3rem", margin: 0, fontWeight: "900", color: "var(--bright-gold)" }}>{countdown.toFixed(1)}s</h1>
                </div>
              ) : gameStatus === "flying" ? (
                <div style={styles.multiplierBox}>
                  <h1 className="gold-text" style={styles.multiplierValue}>
                    {currentMultiplier.toFixed(2)}x
                  </h1>
                </div>
              ) : (
                <div style={styles.crashedBox}>
                  <span style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.6)", letterSpacing: "1.5px" }}>O AVIÃOZINHO</span>
                  <h1 style={{ fontSize: "3.2rem", margin: 0, fontWeight: "900", color: "#ef5350" }}>DECOLOU!</h1>
                  <span style={{ fontSize: "1.2rem", fontWeight: "700", color: "var(--bright-gold)", marginTop: "4px" }}>
                    Crashed @ {currentMultiplier.toFixed(2)}x
                  </span>
                </div>
              )}
            </div>

            {/* In-Flight User Cashout Projection Display */}
            {hasBet && !isCashedOut && gameStatus === "flying" && (
              <div style={styles.winProjectionBadge}>
                CKB$ {(activeBetAmount * currentMultiplier).toFixed(2)}
              </div>
            )}
          </div>

          {/* Betting Controls Card */}
          <div style={styles.controlsCard} className="glass-panel">
            {/* Bet Input row */}
            <div style={styles.betRow}>
              <div style={styles.controlGroup} className="flex-1">
                <span style={styles.controlLabel}>Valor da Aposta</span>
                <input
                  type="number"
                  min="10"
                  max="10000"
                  step="10"
                  value={betInput}
                  onChange={(e) => setBetInput(e.target.value)}
                  disabled={hasBet || gameStatus === "flying"}
                  className="form-input"
                  style={{ height: "42px", fontSize: "0.95rem" }}
                />
              </div>

              {/* Predefined Quick Bets */}
              <div style={styles.quickBetsRow}>
                {[50, 100, 200, 500].map(val => (
                  <button 
                    key={val}
                    style={styles.quickBetBtn}
                    onClick={() => setBetInput(val.toString())}
                    disabled={hasBet || gameStatus === "flying"}
                  >
                    +{val}
                  </button>
                ))}
              </div>
            </div>

            {/* Big Action Button */}
            {gameStatus === "betting" ? (
              hasBet ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <button 
                    disabled 
                    className="btn-primary" 
                    style={{ ...styles.crashActionBtn, background: "rgba(255,255,255,0.05)", border: "1px dashed rgba(255,255,255,0.15)", color: "var(--text-muted)" }}
                  >
                    APOSTA LANÇADA (ESPERANDO...)
                  </button>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center" }}>
                    Você apostou **CKB$ {activeBetAmount.toLocaleString("pt-BR")}** nesta rodada.
                  </span>
                </div>
              ) : (
                <button 
                  onClick={handlePlaceBet}
                  disabled={isApiLoading}
                  className="btn-primary" 
                  style={{ ...styles.crashActionBtn, background: "linear-gradient(135deg, #ffe066 0%, #ffd700 50%, #cc9900 100%)" }}
                >
                  {isApiLoading ? "PROCESSANDO..." : "FAZER APOSTA"}
                </button>
              )
            ) : gameStatus === "flying" ? (
              hasBet && !isCashedOut ? (
                <button 
                  onClick={handleCashOut}
                  disabled={isApiLoading}
                  className="btn-primary" 
                  style={{ ...styles.crashActionBtn, background: "linear-gradient(135deg, #81c784 0%, #4caf50 50%, #2e7d32 100%)", color: "white" }}
                >
                  {isApiLoading ? "RETIRANDO..." : `CASH OUT (CKB$ ${(activeBetAmount * currentMultiplier).toFixed(0)})`}
                </button>
              ) : isCashedOut ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <button 
                    disabled 
                    className="btn-primary" 
                    style={{ ...styles.crashActionBtn, background: "rgba(76, 175, 80, 0.1)", border: "1px solid rgba(76, 175, 80, 0.2)", color: "#81c784" }}
                  >
                    CASH OUT REALIZADO!
                  </button>
                  <span style={{ fontSize: "0.8rem", color: "#81c784", fontWeight: "700", textAlign: "center" }}>
                    Você faturou **+CKB$ {wonAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}**!
                  </span>
                </div>
              ) : (
                <button 
                  disabled 
                  className="btn-primary" 
                  style={{ ...styles.crashActionBtn, background: "rgba(255,255,255,0.03)", color: "var(--text-muted)" }}
                >
                  AGUARDANDO PRÓXIMA RODADA...
                </button>
              )
            ) : (
              // Crashed
              <button 
                disabled 
                className="btn-primary" 
                style={{ ...styles.crashActionBtn, background: "rgba(239, 83, 80, 0.05)", border: "1px solid rgba(239, 83, 80, 0.15)", color: "#ef5350" }}
              >
                O AVIÃO DECOLOU!
              </button>
            )}

            {/* Error alerts */}
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
        </section>

        {/* Right Side: Lobby bets feed & social panel */}
        <section style={styles.socialSection}>
          
          {/* Live Bets Lobby */}
          <div style={styles.socialPanel} className="glass-panel">
            <div style={styles.panelTitle}>
              <Users size={18} color="var(--bright-gold)" />
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Apostas ao Vivo</h3>
            </div>
            
            <div style={styles.socialList}>
              {friendBets.length === 0 ? (
                <div style={styles.emptyList}>Aguardando rodada iniciar...</div>
              ) : (
                friendBets.map((friend, idx) => (
                  <div 
                    key={idx} 
                    style={{
                      ...styles.liveBetRow,
                      borderLeft: friend.status === "cashed_out" ? "3px solid #81c784" :
                                  friend.status === "crashed" ? "3px solid #ef5350" : "3px solid #ffd700",
                      background: friend.status === "cashed_out" ? "rgba(76,175,80,0.05)" : "rgba(0,0,0,0.15)"
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "0.85rem", fontWeight: "700" }}>{friend.username}</span>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                        Aposta: CKB$ {friend.betAmount}
                      </span>
                    </div>

                    <div style={{ marginLeft: "auto", textAlign: "right" }}>
                      {friend.status === "cashed_out" ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                          <span style={{ color: "#81c784", fontWeight: "700", fontSize: "0.88rem" }}>
                            +{friend.cashoutMultiplier}x
                          </span>
                          <span style={{ fontSize: "0.7rem", color: "rgba(129, 199, 132, 0.8)" }}>
                            CKB$ {(friend.betAmount * friend.cashoutMultiplier!).toFixed(0)}
                          </span>
                        </div>
                      ) : friend.status === "crashed" ? (
                        <span style={{ color: "#ef5350", fontSize: "0.78rem", fontWeight: "600" }}>
                          Decolou!
                        </span>
                      ) : (
                        <span style={{ color: "var(--bright-gold)", fontSize: "0.78rem" }} className="roaring-tiger">
                          Voando...
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

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
        </section>
      </main>
    </div>
  );
}

// Custom internal styles
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
  historyBar: {
    display: "flex",
    alignItems: "center",
    padding: "10px 16px",
    overflow: "hidden",
  },
  historyList: {
    display: "flex",
    gap: "8px",
    overflowX: "auto",
    flex: 1,
    paddingRight: "10px",
  },
  historyBadge: {
    padding: "4px 10px",
    borderRadius: "20px",
    fontSize: "0.8rem",
    fontWeight: "800",
    border: "1px solid",
    whiteSpace: "nowrap",
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
    gap: "20px",
  },
  canvasContainer: {
    width: "100%",
    position: "relative",
    background: "#080505",
    border: "2px solid rgba(255, 215, 0, 0.15)",
    borderRadius: "12px",
    overflow: "hidden",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5), inset 0 0 20px rgba(0,0,0,0.8)",
  },
  canvasOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  countdownBox: {
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    background: "rgba(10, 5, 5, 0.8)",
    padding: "16px 28px",
    borderRadius: "12px",
    border: "1px solid rgba(255, 215, 0, 0.2)",
    animation: "fadeIn 0.3s ease",
  },
  multiplierBox: {
    textAlign: "center",
  },
  multiplierValue: {
    fontSize: "4.8rem",
    margin: 0,
    fontWeight: "900",
    textShadow: "0 4px 15px rgba(255, 215, 0, 0.35)",
  },
  crashedBox: {
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    animation: "fadeIn 0.2s ease",
  },
  winProjectionBadge: {
    position: "absolute",
    bottom: "20px",
    left: "20px",
    background: "rgba(76, 175, 80, 0.9)",
    color: "white",
    padding: "6px 14px",
    borderRadius: "20px",
    fontSize: "0.85rem",
    fontWeight: "800",
    border: "1px solid rgba(76, 175, 80, 0.3)",
    boxShadow: "0 0 10px rgba(76, 175, 80, 0.4)",
  },
  controlsCard: {
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    background: "linear-gradient(180deg, rgba(80,10,10,0.6) 0%, rgba(30,5,5,0.7) 100%)",
    border: "1px solid rgba(255, 215, 0, 0.15)",
  },
  betRow: {
    display: "flex",
    gap: "16px",
    alignItems: "flex-end",
    flexWrap: "wrap",
  },
  quickBetsRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginBottom: "2px",
  },
  quickBetBtn: {
    padding: "8px 12px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "8px",
    color: "white",
    fontSize: "0.8rem",
    fontWeight: "700",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  crashActionBtn: {
    width: "100%",
    height: "50px",
    fontSize: "1.25rem",
    fontWeight: "800",
    borderRadius: "10px",
    cursor: "pointer",
  },
  socialSection: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  socialPanel: {
    padding: "20px",
  },
  panelTitle: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    borderBottom: "1px solid rgba(255, 215, 0, 0.15)",
    paddingBottom: "12px",
    marginBottom: "16px",
  },
  claimBody: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  cooldownContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    padding: "12px",
    background: "rgba(0, 0, 0, 0.2)",
    border: "1px dashed rgba(255,255,255,0.15)",
    borderRadius: "10px",
    fontSize: "0.9rem",
    color: "var(--text-muted)",
  },
  claimMsgAlert: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 14px",
    borderRadius: "8px",
    border: "1px solid",
    fontSize: "0.82rem",
    lineHeight: "1.4",
  },
  socialList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    maxHeight: "360px",
    overflowY: "auto",
    paddingRight: "4px",
  },
  leaderboardRow: {
    display: "flex",
    alignItems: "center",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid transparent",
    fontSize: "0.88rem",
  },
  leaderboardRank: {
    width: "28px",
    fontWeight: "700",
    display: "flex",
    alignItems: "center",
  },
  leaderboardValue: {
    marginLeft: "auto",
    fontWeight: "700",
    color: "var(--bright-gold)",
  },
  liveBetRow: {
    display: "flex",
    alignItems: "center",
    padding: "10px 12px",
    borderRadius: "8px",
    fontSize: "0.88rem",
    border: "1px solid rgba(255,255,255,0.03)",
  },
  emptyList: {
    textAlign: "center",
    padding: "20px 0",
    color: "var(--text-muted)",
    fontSize: "0.85rem",
  }
};
