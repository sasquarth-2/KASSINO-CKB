// O Racha (Racha do Ka) Frontend View - KASSINO-CKB
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import { gameAudio } from "@/lib/audio-manager";
import { 
  Volume2, VolumeX, ArrowLeft, Coins, Play, 
  HelpCircle, AlertTriangle, CheckCircle2, Sparkles, Trophy
} from "lucide-react";
import confetti from "canvas-confetti";

interface Profile {
  id: string;
  username: string;
  balance: number;
}

const VEHICLES = [
  { id: "purpple-horse", name: "Cavalo Roxo", multiplier: 2.0, color: "#9c27b0" },
  { id: "green-horse", name: "Cavalo Verde", multiplier: 4.0, color: "#4caf50" },
  { id: "yellow-horse", name: "Cavalo Amarelo", multiplier: 5.0, color: "#ffeb3b" },
  { id: "blue-horse", name: "Cavalo Azul", multiplier: 8.0, color: "#2196f3" },
  { id: "ford-ka", name: "Ford KA (Eduardo)", multiplier: 100.0, color: "#ef5350" }
];

export default function RachaGame() {
  const router = useRouter();

  // Auth & Profile states
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Layout Responsive state
  const [isMobile, setIsMobile] = useState(false);

  // Game Loop states
  const [gameStatus, setGameStatus] = useState<"betting" | "racing" | "reset">("betting");
  const [roundId, setRoundId] = useState<string>("");
  const [bettingStartTime, setBettingStartTime] = useState<number>(0);
  const [raceStartTime, setRaceStartTime] = useState<number | null>(null);
  const [serverTimeOffset, setServerTimeOffset] = useState<number>(0);
  const [countdown, setCountdown] = useState<number>(10.0);
  const [winningVehicle, setWinningVehicle] = useState<string | null>(null);

  // Animated Positions state (progress 0 to 1 for the 5 lanes)
  const [positions, setPositions] = useState<Record<string, number>>({
    "purpple-horse": 0,
    "green-horse": 0,
    "yellow-horse": 0,
    "blue-horse": 0,
    "ford-ka": 0
  });

  // Player Bet states
  const [betInput, setBetInput] = useState<string>("100");
  const [selectedVehicle, setSelectedVehicle] = useState<string>("ford-ka");
  const [hasBet, setHasBet] = useState<boolean>(false);
  const [betRoundId, setBetRoundId] = useState<string | null>(null);
  const [betAmountPlaced, setBetAmountPlaced] = useState<number>(0);
  const [betVehiclePlaced, setBetVehiclePlaced] = useState<string | null>(null);
  
  // API and Payout states
  const [isApiLoading, setIsApiLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [resultChecked, setResultChecked] = useState<boolean>(false);

  // Animation frame ref
  const animRef = useRef<number | null>(null);

  // Sound toggler
  const handleToggleMute = () => {
    const muted = gameAudio.toggleMute();
    setIsMuted(muted);
  };

  // Fetch User Profile
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
        .select("id, username, balance")
        .eq("id", session.user.id)
        .single();

      if (error) throw error;
      setProfile(prof);
    } catch (err) {
      console.error("Profile load error:", err);
    } finally {
      setLoadingProfile(false);
    }
  }, [router]);

  useEffect(() => {
    fetchProfileData();

    // Responsive screen resize listener
    const handleResize = () => {
      setIsMobile(window.innerWidth < 860);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [fetchProfileData]);

  // Hash string helper for deterministic noise
  const hashString = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
  };

  // Deterministic trajectory progress calculator
  const getVehicleProgress = useCallback((laneId: string, elapsed: number, isWinner: boolean, rId: string) => {
    if (elapsed <= 0) return 0;
    
    // Hash based seed for this lane and round
    const seed = hashString(laneId + rId);
    
    // final progress for losers is between 0.78 and 0.96
    const endProgress = isWinner ? 1.0 : 0.78 + 0.18 * ((seed % 10) / 10);
    
    if (elapsed >= 8.0) return endProgress;
    
    // Base progression speed curve (accelerates)
    const baseProgress = Math.pow(elapsed / 8.0, 1.4);
    
    // Varying wave noise to create overtaking and tension
    const waveFreq = 1.6 + (seed % 3) * 0.4; // 1.6 to 2.4
    const waveAmp = 0.04 + (seed % 5) * 0.01; // 0.04 to 0.08
    const noise = Math.sin(elapsed * waveFreq) * waveAmp * (1 - baseProgress) * (elapsed / 8.0);
    
    let currentProgress = baseProgress * endProgress + noise;
    
    // Constrain bounds
    currentProgress = Math.max(0, Math.min(endProgress, currentProgress));
    
    // Force winner to merge perfectly into 100% (1.0) near the finish line
    if (isWinner && elapsed >= 7.6) {
      const lerpFactor = (elapsed - 7.6) / 0.4; // 0 to 1
      currentProgress = currentProgress * (1 - lerpFactor) + 1.0 * lerpFactor;
    }
    
    return currentProgress;
  }, []);

  // claim outcome from server
  const claimRoundResult = useCallback(async (rId: string) => {
    if (!sessionToken || resultChecked || isApiLoading) return;
    setIsApiLoading(true);
    setResultChecked(true);

    try {
      const res = await fetch("/api/racha/result", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ roundId: rId })
      });
      const data = await res.json();

      if (res.ok && data.hasBet) {
        if (data.won) {
          const vehicle = VEHICLES.find(v => v.id === data.winningVehicle);
          setClaimMessage({
            text: `VITÓRIA! O ${vehicle?.name} venceu a corrida e você ganhou CKB$ ${formatBalance(data.winAmount)} (${data.multiplier}x)!`,
            type: "success"
          });
          gameAudio.playWin();
          confetti({ particleCount: 70, spread: 60, origin: { y: 0.85 } });
        } else {
          const vehicle = VEHICLES.find(v => v.id === data.winningVehicle);
          setClaimMessage({
            text: `Racha encerrado! O vencedor foi ${vehicle?.name.toUpperCase()}.`,
            type: "info"
          });
          gameAudio.playStop(0.85); // play crash sound
        }
        
        // Update balance locally
        setProfile(prev => prev ? { ...prev, balance: data.newBalance } : null);
      }
    } catch (err) {
      console.error("Result claim error:", err);
    } finally {
      setIsApiLoading(false);
    }
  }, [sessionToken, resultChecked, isApiLoading]);

  // Synchronize state machine with database
  const fetchGlobalSync = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const res = await fetch("/api/racha/sync", {
        headers: {
          "Authorization": `Bearer ${sessionToken}`
        }
      });
      if (!res.ok) return;
      const data = await res.json();

      const localNow = Date.now();
      const offset = data.serverTime - localNow;
      setServerTimeOffset(offset);

      const oldStatus = gameStatus;
      setGameStatus(data.status);
      setRoundId(data.roundId);
      setBettingStartTime(data.bettingStartTime);
      setRaceStartTime(data.raceStartTime);
      setWinningVehicle(data.winningVehicle);

      // Handle transitions
      if (data.status === "betting") {
        const elapsed = (localNow + offset) - data.bettingStartTime;
        const timeLeft = Math.max(0, 10.0 - elapsed / 1000);
        setCountdown(parseFloat(timeLeft.toFixed(1)));
        
        // Reset positions
        setPositions({
          "purpple-horse": 0,
          "green-horse": 0,
          "yellow-horse": 0,
          "blue-horse": 0,
          "ford-ka": 0
        });

        // Reset player bet state for the new round
        if (oldStatus !== "betting") {
          setHasBet(false);
          setBetRoundId(null);
          setBetAmountPlaced(0);
          setBetVehiclePlaced(null);
          setClaimMessage(null);
          setResultChecked(false);
        }
      } else if (data.status === "reset") {
        // Triggers claim if player had a bet
        if (betRoundId === data.roundId && !resultChecked) {
          claimRoundResult(data.roundId);
        }
      }
    } catch (err) {
      console.error("Racha sync failed:", err);
    }
  }, [sessionToken, gameStatus, betRoundId, resultChecked, claimRoundResult]);

  useEffect(() => {
    fetchGlobalSync();
  }, [fetchGlobalSync]);

  // Adaptive sync interval depending on phase
  useEffect(() => {
    const intervalTime = gameStatus === "racing" ? 900 : 2000;
    const interval = setInterval(fetchGlobalSync, intervalTime);
    return () => clearInterval(interval);
  }, [gameStatus, fetchGlobalSync]);

  // Local clock updates for countdown (during betting) and racing progress updates (during race)
  useEffect(() => {
    if (gameStatus === "betting") {
      const interval = setInterval(() => {
        setCountdown(prev => Math.max(0, parseFloat((prev - 0.1).toFixed(1))));
      }, 100);
      return () => clearInterval(interval);
    }

    if (gameStatus === "racing" && raceStartTime) {
      let isSubscribed = true;

      const updateLoop = () => {
        if (!isSubscribed) return;
        const localNow = Date.now();
        const elapsed = (localNow + serverTimeOffset - raceStartTime) / 1000;

        const newPos: Record<string, number> = {};
        VEHICLES.forEach(v => {
          const isWinner = winningVehicle === v.id;
          newPos[v.id] = getVehicleProgress(v.id, elapsed, isWinner, roundId);
        });

        setPositions(newPos);

        if (elapsed < 8.0) {
          animRef.current = requestAnimationFrame(updateLoop);
        } else {
          // Force final position caps at end of race
          const finalPos: Record<string, number> = {};
          VEHICLES.forEach(v => {
            const isWinner = winningVehicle === v.id;
            finalPos[v.id] = isWinner ? 1.0 : getVehicleProgress(v.id, 8.0, isWinner, roundId);
          });
          setPositions(finalPos);
        }
      };

      animRef.current = requestAnimationFrame(updateLoop);

      return () => {
        isSubscribed = false;
        if (animRef.current) cancelAnimationFrame(animRef.current);
      };
    }
  }, [gameStatus, raceStartTime, serverTimeOffset, winningVehicle, roundId, getVehicleProgress]);

  // Place Bet handler
  const handlePlaceBet = async () => {
    if (!sessionToken || hasBet || isApiLoading) return;
    setIsApiLoading(true);
    setErrorMessage(null);

    const betAmount = parseFloat(betInput);
    if (isNaN(betAmount) || betAmount < 10 || betAmount > 10000) {
      setErrorMessage("Aposta deve ser entre CKB$ 10 e CKB$ 10.000");
      setIsApiLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/racha/bet", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          betAmount,
          selectedVehicle
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Erro ao registrar aposta.");
      } else {
        setHasBet(true);
        setBetRoundId(data.roundId);
        setBetAmountPlaced(betAmount);
        setBetVehiclePlaced(selectedVehicle);
        setProfile(prev => prev ? { ...prev, balance: data.newBalance } : null);
        gameAudio.playWin();
      }
    } catch (err) {
      console.error("Bet error:", err);
      setErrorMessage("Erro ao conectar ao servidor.");
    } finally {
      setIsApiLoading(false);
    }
  };

  const formatBalance = (val: number) => {
    return val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (loadingProfile) {
    return (
      <div style={styles.loaderContainer}>
        <Coins size={48} className="roaring-tiger" color="var(--bright-gold)" />
        <h3 className="gold-text" style={{ marginTop: "12px" }}>Acessando arquibancada do racha...</h3>
      </div>
    );
  }

  return (
    <div style={styles.dashboardContainer}>
      {/* Header bar */}
      <header className="nav-bar glass-panel" style={styles.navBar}>
        <div style={styles.navLeft}>
          <button style={styles.backBtn} onClick={() => router.push("/dashboard")} title="Voltar ao Lobby">
            <ArrowLeft size={20} color="var(--bright-gold)" />
          </button>
          <Coins size={24} color="var(--bright-gold)" style={{ marginLeft: "8px" }} />
          <h2 className="gold-text" style={{ fontSize: "1.4rem", margin: 0 }}>O Racha</h2>
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
          <button style={styles.iconBtn} onClick={handleToggleMute} title={isMuted ? "Desativar Mudo" : "Mudar Mudo"}>
            {isMuted ? <VolumeX size={18} color="#ef5350" /> : <Volume2 size={18} color="var(--bright-gold)" />}
          </button>
        </div>
      </header>

      {/* Main content grid */}
      <main style={{
        ...styles.mainGrid,
        display: isMobile ? "flex" : "grid",
        flexDirection: isMobile ? "column" : "row",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 360px",
        gap: isMobile ? "16px" : "24px"
      }}>
        
        {/* Left Side: Race Track Screen */}
        <section style={styles.gameSection} className="glass-panel">
          <div style={styles.trackViewport}>
            {/* Start & Finish line markers */}
            <div style={styles.startLine} />
            <div style={styles.finishLine} />
            
            {/* Lanes loop */}
            {VEHICLES.map((v, index) => {
              const progress = positions[v.id] || 0;
              const leftPercent = 10 + progress * 74; // starts at 10%, finishes at 84%
              
              return (
                <div key={v.id} style={{
                  ...styles.laneRow,
                  borderBottom: index === VEHICLES.length - 1 ? "none" : "1px dashed rgba(255,255,255,0.06)"
                }}>
                  <div style={{
                    ...styles.spriteWrapper,
                    left: `${leftPercent}%`
                  }}>
                    <img 
                      src={`/images/${v.id}.png`} 
                      alt={v.name} 
                      style={styles.spriteImg} 
                    />
                    <span style={{
                      ...styles.spriteLabel,
                      background: v.color
                    }}>
                      {v.id === "ford-ka" ? "KA" : v.name.split(" ")[1]}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Overlays for different phases */}
            {gameStatus === "betting" && (
              <div style={styles.trackOverlay}>
                <div style={styles.countdownBox} className="glass-panel">
                  <Play size={20} fill="currentColor" color="var(--bright-gold)" style={{ animation: "pulse 1s infinite" }} />
                  <span style={styles.timerText}>CORRIDA EM: {countdown.toFixed(1)}s</span>
                </div>
              </div>
            )}

            {gameStatus === "reset" && (
              <div style={styles.trackOverlay}>
                <div style={styles.resultBox} className="glass-panel">
                  <Trophy size={24} color="var(--bright-gold)" />
                  <span style={{ fontSize: "1.1rem", fontWeight: "900", color: "var(--bright-gold)" }}>
                    VENCEDOR: {VEHICLES.find(v => v.id === winningVehicle)?.name.toUpperCase()}!
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Status banner */}
          <div style={styles.statusBanner}>
            {gameStatus === "betting" && (
              <h3 style={{ margin: 0, color: "var(--text-light)" }}>LARGADA IMINENTE! FAÇAM SEUS PALPITES</h3>
            )}
            {gameStatus === "racing" && (
              <h3 className="gold-text" style={{ margin: 0, animation: "blink 1s infinite" }}>
                🏎️ RACHA ACONTECENDO! QUEM LEVA A MELHOR? 🏎️
              </h3>
            )}
            {gameStatus === "reset" && (
              <h3 style={{ margin: 0, color: "var(--text-muted)" }}>CORRIDA CONCLUÍDA. REINICIANDO...</h3>
            )}
          </div>

          {/* Betting controls (moved under track) */}
          <div style={{ width: "100%", maxWidth: "520px", marginTop: "24px", paddingTop: "24px", borderTop: "1px solid rgba(255, 215, 0, 0.15)" }}>
            <h3 className="gold-text" style={{ fontSize: "1.1rem", margin: "0 0 16px 0", textAlign: "center" }}>Painel de Apostas</h3>
            
            <div style={styles.controlGroup}>
              <span style={styles.controlLabel}>VALOR DA APOSTA</span>
              <input
                type="number"
                value={betInput}
                onChange={(e) => setBetInput(e.target.value)}
                disabled={gameStatus !== "betting" || hasBet}
                className="form-input"
                style={{ fontSize: "1rem", padding: "10px" }}
              />
              <div style={styles.presetsGrid}>
                {["50", "100", "200", "500"].map(val => (
                  <button 
                    key={val} 
                    disabled={gameStatus !== "betting" || hasBet}
                    onClick={() => setBetInput(val)}
                    style={styles.presetBtn}
                  >
                    +{val}
                  </button>
                ))}
              </div>
            </div>

            {/* Vehicle selection button grid */}
            <div style={{ ...styles.controlGroup, marginTop: "20px" }}>
              <span style={styles.controlLabel}>ESCOLHA SEU PARTICIPANTE</span>
              <div style={styles.cardsSelectGrid}>
                {VEHICLES.map(v => {
                  const isChosen = selectedVehicle === v.id;
                  return (
                    <button
                      key={v.id}
                      disabled={gameStatus !== "betting" || hasBet}
                      onClick={() => setSelectedVehicle(v.id)}
                      style={{
                        ...styles.cardSelectBtn,
                        borderColor: isChosen ? "var(--bright-gold)" : "rgba(255, 255, 255, 0.1)",
                        background: isChosen ? "rgba(255, 215, 0, 0.08)" : "rgba(0,0,0,0.3)"
                      }}
                      title={`${v.name} (${v.multiplier}x)`}
                    >
                      <img src={`/images/${v.id}.png`} alt={v.name} style={styles.cardSelectIcon} />
                      <span style={{ fontSize: "0.65rem", color: isChosen ? "var(--bright-gold)" : "var(--text-muted)", fontWeight: "bold" }}>
                        {v.multiplier}x
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Place Bet Button */}
            {hasBet ? (
              <div style={styles.betConfirmedBox}>
                <CheckCircle2 size={18} color="#81c784" />
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: "700", color: "#81c784" }}>
                    APOSTA LANÇADA!
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Palpite: <strong>{VEHICLES.find(v => v.id === betVehiclePlaced)?.name.toUpperCase()}</strong> (CKB$ {betAmountPlaced})
                  </span>
                </div>
              </div>
            ) : (
              <button
                disabled={gameStatus !== "betting" || isApiLoading}
                onClick={handlePlaceBet}
                className="btn-primary"
                style={{ 
                  width: "100%", 
                  padding: "14px", 
                  fontSize: "1rem", 
                  marginTop: "24px",
                  opacity: gameStatus !== "betting" ? 0.5 : 1,
                  cursor: gameStatus !== "betting" ? "default" : "pointer"
                }}
              >
                APOSTAR NO PARTICIPANTE
              </button>
            )}

            {errorMessage && (
              <div style={styles.alertMsg}>
                <AlertTriangle size={16} />
                <span>{errorMessage}</span>
              </div>
            )}

            {claimMessage && (
              <div style={{
                ...styles.claimMsgAlert,
                background: claimMessage.type === "success" ? "rgba(76, 175, 80, 0.15)" : "rgba(255, 255, 255, 0.05)",
                borderColor: claimMessage.type === "success" ? "rgba(76, 175, 80, 0.3)" : "rgba(255, 255, 255, 0.15)",
                color: claimMessage.type === "success" ? "#c8e6c9" : "#e0e0e0"
              }}>
                {claimMessage.type === "success" ? <Sparkles size={16} color="var(--bright-gold)" /> : <HelpCircle size={16} />}
                <span>{claimMessage.text}</span>
              </div>
            )}
          </div>
        </section>

        {/* Right Side: Payout checklist */}
        <section style={styles.sidebarSection}>
          <div style={styles.sidebarPanel} className="glass-panel">
            <h3 className="gold-text" style={{ fontSize: "1.1rem", margin: "0 0 16px 0" }}>Tabela de Pagamentos</h3>
            <div style={styles.payoutList}>
              {VEHICLES.map(v => (
                <div key={v.id} style={styles.payoutRow}>
                  <div style={styles.payoutLeft}>
                    <img src={`/images/${v.id}.png`} alt={v.name} style={styles.payoutIcon} />
                    <span>{v.name}</span>
                  </div>
                  <span style={{ 
                    color: v.id === "ford-ka" ? "var(--bright-gold)" : "var(--text-muted)", 
                    fontWeight: "900" 
                  }}>
                    {v.multiplier}x Payout
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

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
  },
  backBtn: {
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "8px",
    width: "36px",
    height: "36px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s ease",
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
    gridTemplateColumns: "1fr 360px",
    gap: "24px",
    alignItems: "start",
  },
  gameSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    background: "linear-gradient(180deg, rgba(50,15,15,0.4) 0%, rgba(20,5,5,0.5) 100%)",
    border: "1px solid rgba(255, 215, 0, 0.15)",
    borderRadius: "16px",
    position: "relative",
    overflow: "hidden",
  },
  trackViewport: {
    width: "100%",
    height: "300px",
    background: "linear-gradient(90deg, #111 0%, #222 15%, #151515 85%, #111 100%)",
    border: "2px solid rgba(255,255,255,0.06)",
    borderRadius: "12px",
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  startLine: {
    position: "absolute",
    left: "10%",
    top: 0,
    bottom: 0,
    width: "6px",
    background: "repeating-linear-gradient(0deg, #fff 0px, #fff 10px, #000 10px, #000 20px)",
    opacity: 0.7,
    zIndex: 2,
  },
  finishLine: {
    position: "absolute",
    left: "84%",
    top: 0,
    bottom: 0,
    width: "10px",
    background: "repeating-linear-gradient(0deg, #ff0 0px, #ff0 10px, #000 10px, #000 20px)",
    boxShadow: "0 0 10px rgba(255,235,59,0.3)",
    zIndex: 2,
  },
  laneRow: {
    flex: 1,
    position: "relative",
    display: "flex",
    alignItems: "center",
    background: "rgba(0,0,0,0.15)",
  },
  spriteWrapper: {
    position: "absolute",
    width: "58px",
    height: "44px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    transition: "left 0.05s linear",
    transform: "translate(-50%, -10%)",
    zIndex: 3,
  },
  spriteImg: {
    width: "42px",
    height: "42px",
    objectFit: "contain",
  },
  spriteLabel: {
    fontSize: "0.58rem",
    color: "black",
    fontWeight: "900",
    padding: "1px 4px",
    borderRadius: "3px",
    marginTop: "-3px",
    lineHeight: "1.1",
    boxShadow: "0 2px 4px rgba(0,0,0,0.4)"
  },
  trackOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    zIndex: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  countdownBox: {
    padding: "16px 28px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    background: "rgba(0,0,0,0.85)",
    border: "1px solid rgba(255,215,0,0.3)",
    borderRadius: "30px",
  },
  timerText: {
    fontSize: "1.1rem",
    fontWeight: "900",
    color: "var(--bright-gold)",
    letterSpacing: "0.5px",
  },
  resultBox: {
    padding: "16px 28px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    background: "rgba(0, 5, 2, 0.88)",
    border: "2px solid var(--bright-gold)",
    borderRadius: "12px",
    boxShadow: "0 0 20px rgba(255,215,0,0.3)",
  },
  statusBanner: {
    marginTop: "16px",
    padding: "8px 24px",
    background: "rgba(0,0,0,0.4)",
    border: "1px solid rgba(255,215,0,0.15)",
    borderRadius: "20px",
    textAlign: "center",
    minWidth: "200px",
  },
  sidebarSection: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  sidebarPanel: {
    padding: "20px",
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
  presetsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "8px",
    marginTop: "6px",
  },
  presetBtn: {
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "6px",
    color: "var(--text-light)",
    fontSize: "0.8rem",
    padding: "6px 0",
    cursor: "pointer",
    fontWeight: "700",
    transition: "all 0.15s ease",
  },
  cardsSelectGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: "8px",
    marginTop: "6px",
  },
  cardSelectBtn: {
    aspectRatio: "1",
    borderWidth: "1px",
    borderStyle: "solid",
    borderRadius: "8px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    padding: "4px 0",
    transition: "all 0.2s ease",
  },
  cardSelectIcon: {
    width: "74%",
    height: "74%",
    objectFit: "contain",
  },
  betConfirmedBox: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "12px",
    background: "rgba(76, 175, 80, 0.15)",
    borderColor: "rgba(76, 175, 80, 0.3)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderRadius: "8px",
    marginTop: "24px",
  },
  alertMsg: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 12px",
    background: "rgba(211, 47, 47, 0.15)",
    borderColor: "rgba(211, 47, 47, 0.3)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderRadius: "8px",
    color: "#ffcdd2",
    fontSize: "0.85rem",
    marginTop: "16px",
  },
  claimMsgAlert: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "12px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderRadius: "8px",
    fontSize: "0.88rem",
    marginTop: "16px",
    lineHeight: "1.4",
  },
  payoutList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  payoutRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: "8px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
  },
  payoutLeft: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "0.9rem",
  },
  payoutIcon: {
    width: "36px",
    height: "36px",
    objectFit: "contain",
  }
};
