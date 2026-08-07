// Landing and Auth Page - Fortune Tiger Clone (KASSINO-CKB)
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import { Lock, User, Key, AlertTriangle, Eye, EyeOff, Coins } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  
  // Form fields
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  
  // UI states
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Check if already authenticated and redirect to dashboard
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.push("/dashboard");
      }
    };
    checkSession();
  }, [router]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    const trimmedNickname = nickname.trim().replace(/\s+/g, "");
    if (!trimmedNickname) {
      setErrorMsg("O apelido (username) não pode conter espaços ou ser vazio.");
      return;
    }

    if (password.length < 6) {
      setErrorMsg("A senha deve ter no mínimo 6 caracteres.");
      return;
    }

    // Map nickname to a dummy email for Supabase Auth, unless they input a full email address (e.g. for super admin)
    const dummyEmail = trimmedNickname.includes("@") ? trimmedNickname.toLowerCase() : `${trimmedNickname.toLowerCase()}@kassino.com`;

    setLoading(true);

    try {
      if (activeTab === "register") {
        // Enforce secret invite code
        const requiredCode = process.env.NEXT_PUBLIC_REGISTRATION_ACCESS_CODE || "CKB-TIGER-2026";
        if (inviteCode !== requiredCode) {
          setErrorMsg("Código de convite incorreto! Peça o código correto ao administrador.");
          setLoading(false);
          return;
        }

        // SignUp
        const { data, error } = await supabase.auth.signUp({
          email: dummyEmail,
          password: password,
          options: {
            data: {
              username: nickname, // Store original display casing
            },
          },
        });

        if (error) {
          setErrorMsg(error.message === "User already registered" 
            ? "Este apelido já está em uso por outro amigo." 
            : error.message);
          setLoading(false);
          return;
        }

        if (data.user) {
          setSuccessMsg("Conta criada com sucesso! Redirecionando...");
          // Wait a second to allow the trigger to finish profile creation, then sign in
          setTimeout(async () => {
            const { error: signInError } = await supabase.auth.signInWithPassword({
              email: dummyEmail,
              password: password,
            });
            if (signInError) {
              setErrorMsg(signInError.message);
              setLoading(false);
            } else {
              router.push("/dashboard");
            }
          }, 1500);
        }
      } else {
        // Login
        const { data, error } = await supabase.auth.signInWithPassword({
          email: dummyEmail,
          password: password,
        });

        if (error) {
          setErrorMsg("Apelido ou senha incorretos.");
          setLoading(false);
          return;
        }

        if (data.session) {
          router.push("/dashboard");
        }
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("Ocorreu um erro no servidor. Tente novamente.");
      setLoading(false);
    }
  };

  return (
    <main style={styles.container}>
      <div style={styles.card} className="glass-panel floating">
        <div style={styles.header}>
          <div style={styles.logoContainer}>
            <Coins size={36} color="var(--bright-gold)" />
            <h1 className="gold-text" style={styles.logoText}>KASSINO CKB</h1>
          </div>
          <p style={styles.subtitle}>Fortune Tiger entre Amigos</p>
        </div>

        {/* Tab Selection */}
        <div style={styles.tabs}>
          <button
            style={{
              ...styles.tabBtn,
              borderBottom: activeTab === "login" ? "3px solid var(--bright-gold)" : "none",
              color: activeTab === "login" ? "var(--bright-gold)" : "var(--text-muted)",
              fontWeight: activeTab === "login" ? "700" : "500",
            }}
            onClick={() => {
              setActiveTab("login");
              setErrorMsg("");
            }}
          >
            Entrar
          </button>
          <button
            style={{
              ...styles.tabBtn,
              borderBottom: activeTab === "register" ? "3px solid var(--bright-gold)" : "none",
              color: activeTab === "register" ? "var(--bright-gold)" : "var(--text-muted)",
              fontWeight: activeTab === "register" ? "700" : "500",
            }}
            onClick={() => {
              setActiveTab("register");
              setErrorMsg("");
            }}
          >
            Criar Conta
          </button>
        </div>

        {/* Alert Notifications */}
        {errorMsg && (
          <div style={styles.errorAlert}>
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div style={styles.successAlert}>
            <span>{successMsg}</span>
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleAuth} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Seu Apelido</label>
            <div style={styles.inputWrapper}>
              <User size={18} style={styles.inputIcon} />
              <input
                type="text"
                placeholder="Ex: joao_player"
                value={nickname}
                onChange={(e) => setNickname(e.target.value.trim())}
                required
                className="form-input"
                style={{ paddingLeft: "42px" }}
                disabled={loading}
              />
            </div>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Sua Senha</label>
            <div style={styles.inputWrapper}>
              <Lock size={18} style={styles.inputIcon} />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="form-input"
                style={{ paddingLeft: "42px", paddingRight: "42px" }}
                disabled={loading}
              />
              <button
                type="button"
                style={styles.eyeBtn}
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {activeTab === "register" && (
            <div style={styles.inputGroup}>
              <label style={styles.label}>Código de Acesso do Grupo</label>
              <div style={styles.inputWrapper}>
                <Key size={18} style={styles.inputIcon} />
                <input
                  type="text"
                  placeholder="Código secreto fornecido pelo admin"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required
                  className="form-input"
                  style={{ paddingLeft: "42px" }}
                  disabled={loading}
                />
              </div>
            </div>
          )}

          <button type="submit" className="btn-primary" style={styles.submitBtn} disabled={loading}>
            {loading ? "Processando..." : activeTab === "login" ? "Entrar na Arena" : "Registrar e Jogar"}
          </button>
        </form>
      </div>
    </main>
  );
}

// Inline styles for fast styling without Tailwind. Follows globals design tokens.
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    padding: "20px",
  },
  card: {
    width: "100%",
    maxWidth: "420px",
    padding: "36px",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    textAlign: "center",
    marginBottom: "24px",
  },
  logoContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    marginBottom: "6px",
  },
  logoText: {
    fontSize: "2.2rem",
    letterSpacing: "1px",
    margin: 0,
  },
  subtitle: {
    fontSize: "0.95rem",
    color: "var(--text-muted)",
  },
  tabs: {
    display: "flex",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
    marginBottom: "24px",
  },
  tabBtn: {
    flex: 1,
    padding: "12px",
    background: "none",
    border: "none",
    fontSize: "1rem",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "18px",
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    fontSize: "0.85rem",
    fontWeight: "600",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  inputWrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },
  inputIcon: {
    position: "absolute",
    left: "14px",
    color: "var(--text-muted)",
    pointerEvents: "none",
  },
  eyeBtn: {
    position: "absolute",
    right: "14px",
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtn: {
    marginTop: "10px",
    width: "100%",
    height: "48px",
  },
  errorAlert: {
    background: "rgba(211, 47, 47, 0.15)",
    border: "1px solid rgba(211, 47, 47, 0.3)",
    borderRadius: "12px",
    padding: "12px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    color: "#ffcdd2",
    fontSize: "0.88rem",
    marginBottom: "20px",
  },
  successAlert: {
    background: "rgba(76, 175, 80, 0.15)",
    border: "1px solid rgba(76, 175, 80, 0.3)",
    borderRadius: "12px",
    padding: "12px",
    color: "#c8e6c9",
    fontSize: "0.88rem",
    textAlign: "center",
    marginBottom: "20px",
  },
};
