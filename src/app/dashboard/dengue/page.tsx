// Blackjack da Dengue Frontend View - KASSINO-CKB
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import { gameAudio } from "@/lib/audio-manager";
import { 
  Volume2, VolumeX, ArrowLeft, Coins, Play, 
  HelpCircle, AlertTriangle, ShieldCheck, CheckCircle2, Flame, Sparkles
} from "lucide-react";
import confetti from "canvas-confetti";

interface Profile {
  id: string;
  username: string;
  balance: number;
}

const CARDS_POOL = [
  { id: "dengue", label: "Dengue (10x Payout)", multiplier: 10.0 },
  { id: "cigaro", label: "Cigaro (4x Payout)", multiplier: 4.0 },
  { id: "frango", label: "Frango (4x Payout)", multiplier: 4.0 },
  { id: "cap-mate", label: "Cap. Mate (4x Payout)", multiplier: 4.0 },
  { id: "sapo", label: "Sapo (4x Payout)", multiplier: 4.0 }
];

export default function DengueGame() {
  const router = useRouter();

  // Auth & Profile states
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Layout Responsive state
  const [isMobile, setIsMobile] = useState(false);

  // Game Loop states
  const [gameStatus, setGameStatus] = useState<"betting" | "revealing" | "reset">("betting");
  const [roundId, setRoundId] = useState<string>("");
  const [bettingStartTime, setBettingStartTime] = useState<number>(0);
  const [serverTimeOffset, setServerTimeOffset] = useState<number>(0);
  const [countdown, setCountdown] = useState<number>(10.0);
  const [winningCard, setWinningCard] = useState<string | null>(null);

  // Player Bet states
  const [betInput, setBetInput] = useState<string>("100");
  const [selectedCard, setSelectedCard] = useState<string>("sapo");
  const [hasBet, setHasBet] = useState<boolean>(false);
  const [betRoundId, setBetRoundId] = useState<string | null>(null);
  const [betAmountPlaced, setBetAmountPlaced] = useState<number>(0);
  const [betCardPlaced, setBetCardPlaced] = useState<string | null>(null);
  
  // API and Payout states
  const [isApiLoading, setIsApiLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [resultChecked, setResultChecked] = useState<boolean>(false);

  // Sound toggle
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

  // claim outcome from server
  const claimRoundResult = useCallback(async (rId: string) => {
    if (!sessionToken || resultChecked || isApiLoading) return;
    setIsApiLoading(true);
    setResultChecked(true);

    try {
      const res = await fetch("/api/dengue/result", {
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
          setClaimMessage({
            text: `PARABÉNS! Você acertou e ganhou CKB$ ${formatBalance(data.winAmount)} (${data.multiplier}x)`,
            type: "success"
          });
          gameAudio.playWin();
          confetti({ particleCount: 60, spread: 50, origin: { y: 0.8 } });
        } else {
          setClaimMessage({
            text: `NÃO FOI DESTA VEZ! Luka revelou ${data.winningCard.toUpperCase()}.`,
            type: "info"
          });
          gameAudio.playStop(1.2); // Loss/wrong guess sound
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
      const res = await fetch("/api/dengue/sync", {
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
      setWinningCard(data.winningCard);

      // Handle transitions
      if (data.status === "betting") {
        const elapsed = (localNow + offset) - data.bettingStartTime;
        const timeLeft = Math.max(0, 10.0 - elapsed / 1000);
        setCountdown(parseFloat(timeLeft.toFixed(1)));
        
        // If transitioning back to betting, reset player bet state for the new round
        if (oldStatus !== "betting") {
          setHasBet(false);
          setBetRoundId(null);
          setBetAmountPlaced(0);
          setBetCardPlaced(null);
          setClaimMessage(null);
          setResultChecked(false);
        }
      } else if (data.status === "revealing") {
        // Triggers card reveal claim if user has a pending bet on this round
        if (betRoundId === data.roundId && !resultChecked) {
          claimRoundResult(data.roundId);
        }
      }
    } catch (err) {
      console.error("Dengue sync failed:", err);
    }
  }, [sessionToken, gameStatus, betRoundId, resultChecked, claimRoundResult]);

  useEffect(() => {
    fetchGlobalSync();
  }, [fetchGlobalSync]);

  // Adaptive sync interval depending on phase
  useEffect(() => {
    const intervalTime = gameStatus === "revealing" ? 800 : 2000;
    const interval = setInterval(fetchGlobalSync, intervalTime);
    return () => clearInterval(interval);
  }, [gameStatus, fetchGlobalSync]);

  // Local countdown timer ticking down at 100ms interval for smooth UI
  useEffect(() => {
    if (gameStatus !== "betting") return;

    const interval = setInterval(() => {
      setCountdown(prev => Math.max(0, parseFloat((prev - 0.1).toFixed(1))));
    }, 100);

    return () => clearInterval(interval);
  }, [gameStatus]);

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
      const res = await fetch("/api/dengue/bet", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          betAmount,
          selectedCard
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Erro ao registrar aposta.");
      } else {
        setHasBet(true);
        setBetRoundId(data.roundId);
        setBetAmountPlaced(betAmount);
        setBetCardPlaced(selectedCard);
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
        <h3 className="gold-text" style={{ marginTop: "12px" }}>Acessando mesa de bar com Luka...</h3>
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
          <h2 className="gold-text" style={{ fontSize: "1.4rem", margin: 0 }}>Blackjack da Dengue</h2>
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
        
        {/* Left Side: Dealer & Mystery Card Screen */}
        <section style={styles.gameSection} className="glass-panel">
          <div style={styles.dealerArea}>
            <img 
              src="/images/luka.png" 
              alt="Luka Dealer" 
              style={styles.dealerImg} 
              className={gameStatus === "betting" ? "floating" : ""}
            />
            
            {/* Mystery card block */}
            <div style={{
              ...styles.mysteryCardContainer,
              transform: gameStatus !== "betting" ? "rotateY(180deg)" : "rotateY(0deg)"
            }}>
              {gameStatus === "betting" ? (
                <div style={styles.cardBack}>
                  <HelpCircle size={44} color="rgba(255, 215, 0, 0.4)" />
                  <span style={styles.countdownTimer}>{countdown.toFixed(1)}s</span>
                </div>
              ) : (
                <div style={styles.cardFront}>
                  {winningCard ? (
                    <img 
                      src={`/images/${winningCard}.png`} 
                      alt={winningCard} 
                      style={styles.cardImg} 
                    />
                  ) : (
                    <div className="loader-spin" style={styles.revealLoader} />
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={styles.statusBanner}>
            {gameStatus === "betting" && (
              <>
                <h3 style={{ margin: 0, color: "var(--text-light)" }}>FAÇAM SUAS APOSTAS!</h3>
                <p style={{ margin: "6px 0 0 0", fontSize: "0.95rem", color: "var(--bright-gold)", fontStyle: "italic" }}>
                  "Que carta estou segurando?"
                </p>
              </>
            )}
            {gameStatus === "revealing" && (
              <h3 className="gold-text" style={{ margin: 0 }}>
                {winningCard ? `LUKA REVELOU: ${winningCard.toUpperCase()}!` : "VIRANDO A CARTA..."}
              </h3>
            )}
            {gameStatus === "reset" && (
              <h3 style={{ margin: 0, color: "var(--text-muted)" }}>PREPARANDO PRÓXIMO TURNO...</h3>
            )}
          </div>

          {/* Betting controls (moved under Luka) */}
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

            {/* Select card options grid */}
            <div style={{ ...styles.controlGroup, marginTop: "20px" }}>
              <span style={styles.controlLabel}>PALPITE DA CARTA</span>
              <div style={styles.cardsSelectGrid}>
                {CARDS_POOL.map(c => {
                  const isChosen = selectedCard === c.id;
                  return (
                    <button
                      key={c.id}
                      disabled={gameStatus !== "betting" || hasBet}
                      onClick={() => setSelectedCard(c.id)}
                      style={{
                        ...styles.cardSelectBtn,
                        borderColor: isChosen ? "var(--bright-gold)" : "rgba(255, 255, 255, 0.1)",
                        background: isChosen ? "rgba(255, 215, 0, 0.08)" : "rgba(0,0,0,0.3)"
                      }}
                      title={c.label}
                    >
                      <img src={`/images/${c.id}.png`} alt={c.id} style={styles.cardSelectIcon} />
                      <span style={{ fontSize: "0.65rem", color: isChosen ? "var(--bright-gold)" : "var(--text-muted)" }}>
                        {c.multiplier}x
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Betting Action Button */}
            {hasBet ? (
              <div style={styles.betConfirmedBox}>
                <CheckCircle2 size={18} color="#81c784" />
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: "700", color: "#81c784" }}>
                    APOSTA LANÇADA!
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Palpite: <strong>{betCardPlaced?.toUpperCase()}</strong> (CKB$ {betAmountPlaced})
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
                APOSTAR NA RODADA
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

        {/* Right Side: Multiplier Payouts Checklist */}
        <section style={styles.sidebarSection}>
          <div style={styles.sidebarPanel} className="glass-panel">
            <h3 className="gold-text" style={{ fontSize: "1.1rem", margin: "0 0 16px 0" }}>Tabela de Pagamentos</h3>
            <div style={styles.payoutList}>
              {CARDS_POOL.map(c => (
                <div key={c.id} style={styles.payoutRow}>
                  <div style={styles.payoutLeft}>
                    <img src={`/images/${c.id}.png`} alt={c.id} style={styles.payoutIcon} />
                    <span style={{ textTransform: "capitalize" }}>
                      {c.id === "cap-mate" ? "Cap. Mate" : (c.id === "cigaro" ? "Cigaro" : c.id)}
                    </span>
                  </div>
                  <span style={{ 
                    color: c.id === "dengue" ? "var(--bright-gold)" : "var(--text-muted)", 
                    fontWeight: "900" 
                  }}>
                    {c.multiplier}x Payout
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
    padding: "40px 20px",
    minHeight: "440px",
    background: "linear-gradient(180deg, rgba(30,10,45,0.4) 0%, rgba(15,5,25,0.5) 100%)",
    border: "1px solid rgba(255, 215, 0, 0.15)",
    borderRadius: "16px",
    position: "relative",
    overflow: "hidden",
  },
  dealerArea: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    width: "280px",
    height: "280px",
  },
  dealerImg: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    zIndex: 1,
  },
  mysteryCardContainer: {
    position: "absolute",
    width: "120px",
    height: "120px",
    borderRadius: "8px",
    overflow: "hidden",
    zIndex: 5,
    top: "190px",
    left: "80px",
    boxShadow: "0 4px 15px rgba(0,0,0,0.5)",
    transition: "transform 0.4s ease",
    transformStyle: "preserve-3d",
  },
  cardBack: {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(135deg, #311b92 0%, #1a0c3a 100%)",
    border: "1px solid rgba(255, 215, 0, 0.3)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
  },
  countdownTimer: {
    fontSize: "0.85rem",
    fontWeight: "900",
    color: "var(--bright-gold)",
    background: "rgba(0,0,0,0.5)",
    padding: "2px 6px",
    borderRadius: "4px",
    letterSpacing: "0.5px",
  },
  cardFront: {
    position: "absolute",
    inset: 0,
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px",
  },
  cardImg: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  revealLoader: {
    width: "24px",
    height: "24px",
    border: "2px solid rgba(255,215,0,0.2)",
    borderTopColor: "var(--bright-gold)",
    borderRadius: "50%",
  },
  statusBanner: {
    marginTop: "24px",
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
    width: "90%",
    height: "90%",
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
    width: "32px",
    height: "32px",
    objectFit: "contain",
  }
};
