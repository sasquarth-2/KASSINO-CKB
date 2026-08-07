// Central Game Lobby Portal - Fortune Juba & Aviãozinho (KASSINO-CKB)
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import { gameAudio } from "@/lib/audio-manager";
import { 
  Volume2, VolumeX, LogOut, Coins, Crown, Flame, 
  Calendar, RotateCcw, AlertCircle, Sparkles, CheckCircle2, Play
} from "lucide-react";
import confetti from "canvas-confetti";

interface Profile {
  id: string;
  username: string;
  balance: number;
  last_daily_claim: string | null;
  is_admin: boolean;
}

export default function Lobby() {
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

  // Sound toggler wrapper
  const handleToggleMute = () => {
    const muted = gameAudio.toggleMute();
    setIsMuted(muted);
  };

  // Check claim cooldown time helper
  const updateClaimCooldown = (lastClaimStr: string | null) => {
    if (!lastClaimStr) {
      setClaimCooldown(null);
      return;
    }
    const lastClaim = new Date(lastClaimStr).getTime();
    const now = new Date().getTime();
    const cooldownMs = 24 * 60 * 60 * 1000; // 24 hours
    
    if (now - lastClaim < cooldownMs) {
      const remainingMs = cooldownMs - (now - lastClaim);
      const hours = Math.floor(remainingMs / (1000 * 60 * 60));
      const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
      setClaimCooldown(`${hours}h ${minutes}m`);
    } else {
      setClaimCooldown(null);
    }
  };

  // 1. Load User Profile from Supabase
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

  // Fetch leaderboard data
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

  // Initial load & Polling
  useEffect(() => {
    const init = async () => {
      await fetchProfileData();
      await fetchSocialData();
    };
    init();

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

  // Logout handler
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  // Format numbers to local currency (e.g., 10.000,00)
  const formatBalance = (val: number) => {
    return val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (loadingProfile) {
    return (
      <div style={styles.loaderContainer}>
        <Coins size={48} className="roaring-tiger" color="var(--bright-gold)" />
        <h3 className="gold-text" style={{ marginTop: "12px" }}>Acessando o Portal...</h3>
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
          <button style={styles.iconBtn} onClick={handleToggleMute} title={isMuted ? "Desativar Mudo" : "Mudar Mudo"}>
            {isMuted ? <VolumeX size={18} color="#ef5350" /> : <Volume2 size={18} color="var(--bright-gold)" />}
          </button>
          <button style={{ ...styles.iconBtn, background: "rgba(239, 83, 80, 0.1)" }} onClick={handleLogout} title="Sair">
            <LogOut size={18} color="#ef5350" />
          </button>
        </div>
      </header>

      {/* Main Grid: Game cards on left, Sidebar on right */}
      <main className="dashboard-grid" style={styles.mainGrid}>
        
        {/* Left Side: Game Grid selection */}
        <section style={styles.lobbyArea}>
          <h2 className="gold-text" style={{ fontSize: "1.8rem", marginBottom: "8px" }}>Arena de Jogos</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginBottom: "24px" }}>
            Selecione uma das opções disponíveis e comece a multiplicar seus CKBucks!
          </p>

          <div style={styles.gameCardsGrid}>
            {/* Game 1: Fortune Juba */}
            <div style={styles.gameCard} className="glass-panel">
              <div style={styles.cardImageArea}>
                <img 
                  src="/images/tiger_mascot.png" 
                  alt="Fortune Juba" 
                  style={styles.cardMascotImg}
                  className="floating"
                />
              </div>
              <div style={styles.cardDetails}>
                <h3 className="gold-text" style={{ fontSize: "1.5rem", margin: "0 0 8px 0" }}>Fortune Juba</h3>
                <p style={styles.cardText}>
                  O clássico slot do tigre. Gire as bobinas com multiplicadores e ative a rodada bônus para buscar até 25.000x!
                </p>
                <button 
                  onClick={() => router.push("/dashboard/fortune-juba")}
                  className="btn-primary" 
                  style={{ width: "100%", marginTop: "auto" }}
                >
                  <Play size={16} fill="currentColor" /> JOGAR TIGRE
                </button>
              </div>
            </div>

            {/* Game 2: Aviãozinho */}
            <div style={styles.gameCard} className="glass-panel">
              <div style={styles.cardImageArea}>
                <img 
                  src="/images/aviaozinho.png" 
                  alt="Aviãozinho" 
                  style={styles.cardPlaneImg}
                  className="floating"
                />
              </div>
              <div style={styles.cardDetails}>
                <h3 className="gold-text" style={{ fontSize: "1.5rem", margin: "0 0 8px 0" }}>Aviãozinho</h3>
                <p style={styles.cardText}>
                  Decole rumo às nuvens e acompanhe o multiplicador subir. Faça o Cash Out a tempo antes que o avião decole para longe!
                </p>
                <button 
                  onClick={() => router.push("/dashboard/aviaozinho")}
                  className="btn-primary" 
                  style={{ width: "100%", marginTop: "auto" }}
                >
                  <Play size={16} fill="currentColor" /> JOGAR CRASH
                </button>
              </div>
            </div>

            {/* Game 3: Capitão do Mate */}
            <div style={{ ...styles.gameCard, background: "linear-gradient(180deg, rgba(12,35,16,0.6) 0%, rgba(5,15,8,0.7) 100%)" }} className="glass-panel">
              <div style={styles.cardImageArea}>
                <img 
                  src="/images/cap-mate.png" 
                  alt="Capitão do Mate" 
                  style={styles.cardMateImg}
                  className="floating"
                />
              </div>
              <div style={styles.cardDetails}>
                <h3 className="gold-text" style={{ fontSize: "1.5rem", margin: "0 0 8px 0" }}>Capitão do Mate</h3>
                <p style={styles.cardText}>
                  Desvire as cartas, encontre os conjuntos de animais selvagens e fuja do Capitão do Mate para acumular multiplicadores de até 50x!
                </p>
                <button 
                  onClick={() => router.push("/dashboard/cap-mate")}
                  className="btn-primary" 
                  style={{ width: "100%", marginTop: "auto" }}
                >
                  <Play size={16} fill="currentColor" /> Jogar Cap. do Mate
                </button>
              </div>
            </div>

            {/* Game 4: Blackjack da Dengue */}
            <div style={{ ...styles.gameCard, background: "linear-gradient(180deg, rgba(30,10,45,0.6) 0%, rgba(15,5,25,0.7) 100%)" }} className="glass-panel">
              <div style={styles.cardImageArea}>
                <img 
                  src="/images/black-jack.png" 
                  alt="Blackjack da Dengue" 
                  style={styles.cardLukaImg}
                  className="floating"
                />
              </div>
              <div style={styles.cardDetails}>
                <h3 className="gold-text" style={{ fontSize: "1.5rem", margin: "0 0 8px 0" }}>Blackjack da Dengue</h3>
                <p style={styles.cardText}>
                  Adivinhe qual carta o Luka está segurando na mesa de bar. Acerte e multiplique por 4x, ou tire a carta Dengue e ganhe 10x!
                </p>
                <button 
                  onClick={() => router.push("/dashboard/dengue")}
                  className="btn-primary" 
                  style={{ width: "100%", marginTop: "auto" }}
                >
                  <Play size={16} fill="currentColor" /> Jogar Blackjack
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Right Side: Social Panels */}
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
        </section>
      </main>
    </div>
  );
}

// Styling system
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
  lobbyArea: {
    display: "flex",
    flexDirection: "column",
  },
  gameCardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "24px",
  },
  gameCard: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: "16px",
    background: "linear-gradient(180deg, rgba(80,10,10,0.6) 0%, rgba(30,5,5,0.7) 100%)",
    border: "1px solid rgba(255, 215, 0, 0.15)",
    transition: "transform 0.3s ease, border-color 0.3s ease",
    minHeight: "420px",
  },
  cardImageArea: {
    height: "220px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.25)",
    borderBottom: "1px solid rgba(255, 215, 0, 0.1)",
    padding: "24px",
  },
  cardMascotImg: {
    width: "140px",
    height: "140px",
    objectFit: "contain",
  },
  cardPlaneImg: {
    width: "180px",
    height: "180px",
    objectFit: "contain",
  },
  cardMateImg: {
    width: "150px",
    height: "150px",
    objectFit: "contain",
  },
  cardLukaImg: {
    width: "150px",
    height: "150px",
    objectFit: "contain",
  },
  cardDetails: {
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    flex: 1,
  },
  cardText: {
    color: "var(--text-muted)",
    fontSize: "0.88rem",
    lineHeight: "1.5",
    marginBottom: "24px",
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
  emptyList: {
    textAlign: "center",
    padding: "20px 0",
    color: "var(--text-muted)",
    fontSize: "0.85rem",
  }
};
