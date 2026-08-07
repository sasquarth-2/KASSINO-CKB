// Capitão do Mate Frontend View - KASSINO-CKB
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import { gameAudio } from "@/lib/audio-manager";
import { 
  Volume2, VolumeX, ArrowLeft, Coins, Play, 
  HelpCircle, AlertTriangle, ShieldCheck, CheckCircle2, Flame, Award
} from "lucide-react";
import confetti from "canvas-confetti";

interface Profile {
  id: string;
  username: string;
  balance: number;
}

interface CardState {
  isRevealed: boolean;
  symbol: string | null; // 'cap-mate' | 'chimpa' | 'mico' | 'urso'
}

export default function CapMateGame() {
  const router = useRouter();

  // Auth & Profile states
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Game Play States
  const [gameState, setGameState] = useState<"idle" | "playing" | "won" | "lost">("idle");
  const [betInput, setBetInput] = useState<string>("100");
  const [activeBet, setActiveBet] = useState<number>(0);
  const [cards, setCards] = useState<CardState[]>(Array(36).fill({ isRevealed: false, symbol: null }));
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  
  // Stateless Encryption Tokens
  const [gameToken, setGameToken] = useState<string | null>(null);
  const [gameSignature, setGameSignature] = useState<string | null>(null);

  // Messages
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [winMessage, setWinMessage] = useState<{ win: number; mult: number } | null>(null);

  // Sound toggler
  const handleToggleMute = () => {
    const muted = gameAudio.toggleMute();
    setIsMuted(muted);
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
        .select("id, username, balance")
        .eq("id", session.user.id)
        .single();

      if (error) throw error;
      setProfile(prof);
    } catch (err) {
      console.error("Error loading profile:", err);
    } finally {
      setLoadingProfile(false);
    }
  }, [router]);

  useEffect(() => {
    fetchProfileData();
  }, [fetchProfileData]);

  // Helpers to count revealed animals
  const getRevealedCounts = () => {
    let chimpa = 0;
    let mico = 0;
    let urso = 0;
    let mines = 0;

    cards.forEach(c => {
      if (c.isRevealed) {
        if (c.symbol === "chimpa") chimpa++;
        if (c.symbol === "mico") mico++;
        if (c.symbol === "urso") urso++;
        if (c.symbol === "cap-mate") mines++;
      }
    });

    return { chimpa, mico, urso, mines };
  };

  const counts = getRevealedCounts();

  // Calculate current multiplier based on counts
  const calculateCurrentMultiplier = () => {
    let chimpaMult = 0;
    if (counts.chimpa >= 6) chimpaMult = 15.0;
    else if (counts.chimpa >= 4) chimpaMult = 3.0;
    else if (counts.chimpa >= 3) chimpaMult = 1.5;

    let micoMult = 0;
    if (counts.mico >= 6) micoMult = 25.0;
    else if (counts.mico >= 4) micoMult = 4.5;
    else if (counts.mico >= 3) micoMult = 2.0;

    let ursoMult = 0;
    if (counts.urso >= 6) ursoMult = 50.0;
    else if (counts.urso >= 4) ursoMult = 6.0;
    else if (counts.urso >= 3) ursoMult = 3.0;

    return parseFloat((chimpaMult + micoMult + ursoMult).toFixed(2));
  };

  const currentMultiplier = calculateCurrentMultiplier();
  const currentPotentialWin = parseFloat((activeBet * currentMultiplier).toFixed(2));

  // Initialize Game API
  const handleStartGame = async () => {
    if (!sessionToken || gameState === "playing") return;
    setErrorMessage(null);
    setWinMessage(null);

    const betAmount = parseFloat(betInput);
    if (isNaN(betAmount) || betAmount < 10 || betAmount > 10000) {
      setErrorMessage("Aposta deve ser entre CKB$ 10 e CKB$ 10.000");
      return;
    }

    if (profile && profile.balance < betAmount) {
      setErrorMessage("Saldo insuficiente");
      return;
    }

    try {
      const res = await fetch("/api/cap-mate/start", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ betAmount })
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Erro ao iniciar o jogo.");
      } else {
        setCards(Array(36).fill({ isRevealed: false, symbol: null }));
        setGameToken(data.token);
        setGameSignature(data.signature);
        setActiveBet(betAmount);
        setGameState("playing");
        setProfile(prev => prev ? { ...prev, balance: data.newBalance } : null);
        gameAudio.playSpin();
      }
    } catch (err) {
      console.error("Start game connection error:", err);
      setErrorMessage("Falha na conexão com o servidor.");
    }
  };

  // Card click handler
  const handleCardClick = async (index: number) => {
    if (gameState !== "playing" || cards[index].isRevealed || loadingIndex !== null) return;
    setErrorMessage(null);
    setLoadingIndex(index);

    try {
      const res = await fetch("/api/cap-mate/reveal", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          token: gameToken,
          signature: gameSignature,
          index
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Erro ao revelar carta.");
        setLoadingIndex(null);
        return;
      }

      if (data.status === "lost") {
        // Player hit the second mine!
        // Reveal all cards
        const fullGrid = data.grid as string[];
        const newCards = cards.map((c, i) => ({
          isRevealed: true,
          symbol: fullGrid[i]
        }));
        
        setCards(newCards);
        setGameState("lost");
        gameAudio.playStop(0.85); // play explosion sound
      } else {
        // Game continues, update cards
        const newCards = [...cards];
        newCards[index] = {
          isRevealed: true,
          symbol: data.symbol
        };
        
        setCards(newCards);
        setGameToken(data.token);
        setGameSignature(data.signature);

        if (data.symbol === "cap-mate") {
          gameAudio.playStop(1.2); // warn sound
        } else {
          gameAudio.playStop(0.9); // clean card flip sound
        }
      }
    } catch (err) {
      console.error("Reveal card error:", err);
      setErrorMessage("Erro ao conectar ao servidor.");
    } finally {
      setLoadingIndex(null);
    }
  };

  // Cash Out API
  const handleCashOut = async () => {
    if (gameState !== "playing" || currentMultiplier <= 0) return;
    setErrorMessage(null);

    try {
      const res = await fetch("/api/cap-mate/cashout", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          token: gameToken,
          signature: gameSignature
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Erro ao realizar Cash Out.");
      } else {
        // Reveal all remaining cards
        const fullGrid = data.grid as string[];
        const newCards = cards.map((c, i) => ({
          isRevealed: true,
          symbol: fullGrid[i]
        }));

        setCards(newCards);
        setGameState("won");
        setWinMessage({ win: data.winAmount, mult: data.totalMultiplier });
        setProfile(prev => prev ? { ...prev, balance: data.newBalance } : null);
        
        // Trigger win audio and confetti
        gameAudio.playWin();
        confetti({ particleCount: 50, spread: 45, origin: { y: 0.8 } });
      }
    } catch (err) {
      console.error("Cashout request error:", err);
      setErrorMessage("Erro ao conectar ao servidor.");
    }
  };

  // Format currency
  const formatBalance = (val: number) => {
    return val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (loadingProfile) {
    return (
      <div style={styles.loaderContainer}>
        <Coins size={48} className="roaring-tiger" color="var(--bright-gold)" />
        <h3 className="gold-text" style={{ marginTop: "12px" }}>Conectando ao Capitão do Mate...</h3>
      </div>
    );
  }

  return (
    <div style={styles.dashboardContainer}>
      {/* Navbar Header */}
      <header className="nav-bar glass-panel" style={styles.navBar}>
        <div style={styles.navLeft}>
          <button style={styles.backBtn} onClick={() => router.push("/dashboard")} title="Voltar ao Lobby">
            <ArrowLeft size={20} color="var(--bright-gold)" />
          </button>
          <Coins size={24} color="var(--bright-gold)" style={{ marginLeft: "8px" }} />
          <h2 className="gold-text" style={{ fontSize: "1.4rem", margin: 0 }}>Capitão do Mate</h2>
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

      {/* Main Content Area */}
      <main style={styles.mainGrid}>
        
        {/* Left Side: 6x6 Card Grid */}
        <section style={styles.gridSection}>
          <div style={styles.gridContainer} className="glass-panel">
            {cards.map((card, i) => {
              const showLoading = loadingIndex === i;
              
              return (
                <div 
                  key={i} 
                  style={{
                    ...styles.cardCell,
                    cursor: (gameState !== "playing" || card.isRevealed) ? "default" : "pointer",
                    transform: card.isRevealed ? "rotateY(0deg)" : "rotateY(0deg)",
                    boxShadow: (!card.isRevealed && gameState === "playing") ? "0 0 10px rgba(255, 215, 0, 0.15)" : "none",
                  }}
                  className={(!card.isRevealed && gameState === "playing") ? "hover-card" : ""}
                  onClick={() => handleCardClick(i)}
                >
                  {card.isRevealed ? (
                    <div style={{
                      ...styles.cardFront,
                      background: card.symbol === "cap-mate" ? "rgba(211, 47, 47, 0.15)" : "rgba(255, 255, 255, 0.03)",
                      border: card.symbol === "cap-mate" ? "1px solid rgba(211, 47, 47, 0.4)" : "1px solid rgba(255, 255, 255, 0.1)"
                    }}>
                      <img 
                        src={`/images/${card.symbol}.png`} 
                        alt={card.symbol!} 
                        style={{
                          ...styles.cardImg,
                          filter: card.symbol === "cap-mate" ? "drop-shadow(0 0 8px #d32f2f)" : "none"
                        }}
                      />
                    </div>
                  ) : (
                    <div style={styles.cardBack}>
                      {showLoading ? (
                        <div className="loader-spin" style={styles.cardLoader} />
                      ) : (
                        <HelpCircle size={22} color="rgba(255, 215, 0, 0.4)" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Overlays for Won / Lost states */}
            {gameState === "won" && winMessage && (
              <div style={styles.overlayScreen} className="glass-panel">
                <Flame size={48} className="roaring-tiger" color="var(--bright-gold)" />
                <h2 className="gold-text" style={{ fontSize: "2.2rem", margin: "10px 0" }}>VITÓRIA!</h2>
                <p style={{ color: "var(--text-light)", fontSize: "1.1rem", margin: "0 0 16px 0" }}>
                  Você ganhou com um multiplicador de <strong>{winMessage.mult}x</strong>!
                </p>
                <h3 className="gold-text" style={{ fontSize: "1.8rem", margin: 0 }}>
                  +CKB$ {formatBalance(winMessage.win)}
                </h3>
                <button className="btn-primary" style={{ marginTop: "20px" }} onClick={handleStartGame}>
                  JOGAR NOVAMENTE
                </button>
              </div>
            )}

            {gameState === "lost" && (
              <div style={{ ...styles.overlayScreen, background: "rgba(20, 5, 5, 0.9)" }} className="glass-panel">
                <AlertTriangle size={48} color="#ef5350" />
                <h2 style={{ fontSize: "2.2rem", margin: "10px 0", color: "#ef5350" }}>EXPLODIU!</h2>
                <p style={{ color: "var(--text-muted)", fontSize: "1rem", margin: "0 0 20px 0" }}>
                  Você encontrou 2 Capitães do Mate e perdeu a aposta.
                </p>
                <button className="btn-primary" style={{ background: "#ef5350", borderColor: "#d32f2f" }} onClick={handleStartGame}>
                  TENTAR NOVAMENTE
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Right Side: Betting Panel & Multiplier Checklist */}
        <section style={styles.sidebarSection}>
          
          {/* Betting Input Panel */}
          <div style={styles.sidebarPanel} className="glass-panel">
            <h3 className="gold-text" style={{ fontSize: "1.1rem", margin: "0 0 16px 0" }}>Painel de Controle</h3>
            
            <div style={styles.controlGroup}>
              <span style={styles.controlLabel}>VALOR DA APOSTA</span>
              <input
                type="number"
                value={betInput}
                onChange={(e) => setBetInput(e.target.value)}
                disabled={gameState === "playing"}
                className="form-input"
                style={{ fontSize: "1rem", padding: "10px" }}
              />
              <div style={styles.betPresetsGrid}>
                {["50", "100", "200", "500"].map(val => (
                  <button 
                    key={val} 
                    disabled={gameState === "playing"}
                    onClick={() => setBetInput(val)}
                    style={styles.presetBtn}
                  >
                    +{val}
                  </button>
                ))}
              </div>
            </div>

            {gameState === "playing" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "24px" }}>
                <div style={styles.potentialWinBadge}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>PRÊMIO ATUAL</span>
                  <h4 className="gold-text" style={{ fontSize: "1.4rem", margin: "4px 0" }}>
                    CKB$ {formatBalance(currentPotentialWin)}
                  </h4>
                  <span style={{ fontSize: "0.8rem", color: "var(--bright-gold)" }}>{currentMultiplier}X Multiplicador</span>
                </div>

                <button 
                  disabled={currentMultiplier <= 0}
                  onClick={handleCashOut}
                  className="btn-primary"
                  style={{ 
                    width: "100%", 
                    padding: "14px", 
                    fontSize: "1rem",
                    opacity: currentMultiplier <= 0 ? 0.5 : 1,
                    cursor: currentMultiplier <= 0 ? "default" : "pointer"
                  }}
                >
                  {currentMultiplier > 0 ? "RETIRAR PRÊMIO" : "REVELE 3 IGUAIS"}
                </button>
              </div>
            ) : (
              <button 
                onClick={handleStartGame}
                className="btn-primary"
                style={{ width: "100%", padding: "14px", fontSize: "1rem", marginTop: "24px" }}
              >
                <Play size={16} fill="currentColor" /> INICIAR JOGO
              </button>
            )}

            {errorMessage && (
              <div style={styles.alertMsg}>
                <AlertTriangle size={16} />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>

          {/* Multiplier Payout Checklist Panel */}
          <div style={styles.sidebarPanel} className="glass-panel">
            <h3 className="gold-text" style={{ fontSize: "1.1rem", margin: "0 0 16px 0" }}>Conjuntos Revelados</h3>
            
            <div style={styles.checklistList}>
              {/* Chimpa */}
              <div style={styles.checkRow}>
                <div style={styles.checkLeft}>
                  <img src="/images/chimpa.png" alt="Chimpa" style={styles.checkIcon} />
                  <div style={styles.checkMeta}>
                    <span style={styles.checkName}>Chimpa</span>
                    <span style={styles.checkCounter}>Revelados: <strong>{counts.chimpa}</strong></span>
                  </div>
                </div>
                <div style={styles.checkTiers}>
                  <span style={{ ...styles.tierBadge, background: counts.chimpa >= 6 ? "var(--bright-gold)" : (counts.chimpa >= 4 ? "rgba(255,215,0,0.15)" : "transparent"), color: counts.chimpa >= 6 ? "black" : "white" }}>6x: 15.0x</span>
                  <span style={{ ...styles.tierBadge, background: (counts.chimpa >= 4 && counts.chimpa < 6) ? "var(--bright-gold)" : (counts.chimpa >= 3 ? "rgba(255,215,0,0.15)" : "transparent"), color: (counts.chimpa >= 4 && counts.chimpa < 6) ? "black" : "white" }}>4x: 3.0x</span>
                  <span style={{ ...styles.tierBadge, background: (counts.chimpa === 3) ? "var(--bright-gold)" : "transparent", color: counts.chimpa === 3 ? "black" : "white" }}>3x: 1.5x</span>
                </div>
              </div>

              {/* Mico */}
              <div style={styles.checkRow}>
                <div style={styles.checkLeft}>
                  <img src="/images/mico.png" alt="Mico" style={styles.checkIcon} />
                  <div style={styles.checkMeta}>
                    <span style={styles.checkName}>Mico</span>
                    <span style={styles.checkCounter}>Revelados: <strong>{counts.mico}</strong></span>
                  </div>
                </div>
                <div style={styles.checkTiers}>
                  <span style={{ ...styles.tierBadge, background: counts.mico >= 6 ? "var(--bright-gold)" : (counts.mico >= 4 ? "rgba(255,215,0,0.15)" : "transparent"), color: counts.mico >= 6 ? "black" : "white" }}>6x: 25.0x</span>
                  <span style={{ ...styles.tierBadge, background: (counts.mico >= 4 && counts.mico < 6) ? "var(--bright-gold)" : (counts.mico >= 3 ? "rgba(255,215,0,0.15)" : "transparent"), color: (counts.mico >= 4 && counts.mico < 6) ? "black" : "white" }}>4x: 4.5x</span>
                  <span style={{ ...styles.tierBadge, background: (counts.mico === 3) ? "var(--bright-gold)" : "transparent", color: counts.mico === 3 ? "black" : "white" }}>3x: 2.0x</span>
                </div>
              </div>

              {/* Urso */}
              <div style={styles.checkRow}>
                <div style={styles.checkLeft}>
                  <img src="/images/urso.png" alt="Urso" style={styles.checkIcon} />
                  <div style={styles.checkMeta}>
                    <span style={styles.checkName}>Urso</span>
                    <span style={styles.checkCounter}>Revelados: <strong>{counts.urso}</strong></span>
                  </div>
                </div>
                <div style={styles.checkTiers}>
                  <span style={{ ...styles.tierBadge, background: counts.urso >= 6 ? "var(--bright-gold)" : (counts.urso >= 4 ? "rgba(255,215,0,0.15)" : "transparent"), color: counts.urso >= 6 ? "black" : "white" }}>6x: 50.0x</span>
                  <span style={{ ...styles.tierBadge, background: (counts.urso >= 4 && counts.urso < 6) ? "var(--bright-gold)" : (counts.urso >= 3 ? "rgba(255,215,0,0.15)" : "transparent"), color: (counts.urso >= 4 && counts.urso < 6) ? "black" : "white" }}>4x: 6.0x</span>
                  <span style={{ ...styles.tierBadge, background: (counts.urso === 3) ? "var(--bright-gold)" : "transparent", color: counts.urso === 3 ? "black" : "white" }}>3x: 3.0x</span>
                </div>
              </div>
            </div>

            {/* Mine Warning Indicator */}
            <div style={{
              ...styles.mineStatusBox,
              background: counts.mines === 1 ? "rgba(255, 152, 0, 0.15)" : (counts.mines >= 2 ? "rgba(211, 47, 47, 0.15)" : "rgba(76, 175, 80, 0.1)"),
              borderColor: counts.mines === 1 ? "rgba(255, 152, 0, 0.3)" : (counts.mines >= 2 ? "rgba(211, 47, 47, 0.3)" : "rgba(76, 175, 80, 0.2)"),
              color: counts.mines === 1 ? "#ffb74d" : (counts.mines >= 2 ? "#e57373" : "#81c784")
            }}>
              {counts.mines === 0 && <ShieldCheck size={18} />}
              {counts.mines === 1 && <AlertTriangle size={18} />}
              {counts.mines >= 2 && <AlertTriangle size={18} />}
              
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: "700" }}>
                  Capitão do Mate: {counts.mines} / 2
                </span>
                <span style={{ fontSize: "0.75rem", opacity: 0.85 }}>
                  {counts.mines === 0 && "Nenhum mine revelado. Continue jogando!"}
                  {counts.mines === 1 && "PERIGO! O próximo encerra o jogo!"}
                  {counts.mines >= 2 && "Jogo encerrado."}
                </span>
              </div>
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
  gridSection: {
    display: "flex",
    flexDirection: "column",
  },
  gridContainer: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    gap: "10px",
    padding: "20px",
    position: "relative",
    aspectRatio: "1",
    background: "rgba(10, 0, 0, 0.4)",
    border: "1px solid rgba(255, 215, 0, 0.15)",
    borderRadius: "16px",
  },
  cardCell: {
    aspectRatio: "1",
    borderRadius: "10px",
    overflow: "hidden",
    position: "relative",
    transition: "all 0.2s ease",
  },
  cardBack: {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(135deg, #0f2c16 0%, #061309 100%)",
    border: "1px solid rgba(255, 215, 0, 0.2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  cardFront: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px",
  },
  cardImg: {
    width: "90%",
    height: "90%",
    objectFit: "contain",
  },
  cardLoader: {
    width: "20px",
    height: "20px",
    border: "2px solid rgba(255, 215, 0, 0.2)",
    borderTopColor: "var(--bright-gold)",
    borderRadius: "50%",
  },
  overlayScreen: {
    position: "absolute",
    inset: 0,
    zIndex: 10,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 20, 5, 0.92)",
    borderRadius: "16px",
    padding: "40px",
    textAlign: "center",
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
  betPresetsGrid: {
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
  potentialWinBadge: {
    background: "rgba(255,215,0,0.06)",
    border: "1px solid rgba(255,215,0,0.2)",
    borderRadius: "10px",
    padding: "12px",
    textAlign: "center",
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
  checklistList: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  checkRow: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    paddingBottom: "12px",
    borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
  },
  checkLeft: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  checkIcon: {
    width: "36px",
    height: "36px",
    objectFit: "contain",
  },
  checkMeta: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  checkName: {
    fontSize: "0.95rem",
    fontWeight: "700",
    color: "var(--text-light)",
  },
  checkCounter: {
    fontSize: "0.75rem",
    color: "var(--text-muted)",
  },
  checkTiers: {
    display: "flex",
    gap: "6px",
  },
  tierBadge: {
    flex: 1,
    fontSize: "0.7rem",
    fontWeight: "900",
    textAlign: "center",
    padding: "4px 0",
    border: "1px solid rgba(255, 215, 0, 0.25)",
    borderRadius: "4px",
    transition: "all 0.2s ease",
  },
  mineStatusBox: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "12px",
    borderRadius: "8px",
    borderWidth: "1px",
    borderStyle: "solid",
    marginTop: "16px",
  }
};
