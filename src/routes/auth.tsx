import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import quiuiLogo from "@/assets/quiui-logo.png.asset.json";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Entrar — Quiui Cost Center" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/dashboard" });
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Conta criada! Você já pode entrar.");
  };

  const handleGoogle = async () => {
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) toast.error(result.error.message);
  };

  return (
    <div className="grid min-h-screen w-full bg-background lg:grid-cols-2">
      {/* Brand panel — light finops */}
      <div className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-14"
        style={{ background: "linear-gradient(180deg, oklch(0.98 0.015 90) 0%, oklch(0.95 0.03 155) 100%)" }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(700px 500px at 85% 15%, oklch(0.78 0.13 85 / 0.28), transparent 60%), radial-gradient(600px 500px at 10% 90%, oklch(0.52 0.13 165 / 0.18), transparent 65%)",
          }}
        />

        <div className="relative flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl gradient-emerald">
            <span className="font-display text-lg font-bold text-[#c9a84c]">L</span>
          </div>
          <div className="leading-tight">
            <div className="font-display text-base font-semibold text-[#052e16]">LeFil</div>
            <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-[#2f4638]">Cost Center</div>
          </div>
        </div>

        <div className="relative space-y-10">
          <div className="space-y-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--emerald-deep)]">
              FinOps · IA · Infra
            </div>
            <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight text-[color:var(--emerald-deep)] xl:text-6xl">
              Cada real de<br />
              nuvem no seu<br />
              <span className="text-[color:var(--emerald-deep)]">radar.</span>
            </h1>
            <p className="max-w-md text-[15px] leading-relaxed text-[#2f4638]">
              Consolide gastos de IA, APIs e infraestrutura em um só painel financeiro.
              Simples, direto, sem ruído.
            </p>
          </div>

          {/* Money cards */}
          <div className="grid max-w-md grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/70 p-5 backdrop-blur-md shadow-[0_10px_30px_-15px_oklch(0.30_0.08_165/0.25)]">
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[color:var(--emerald-deep)]">Economia mensal</div>
              <div className="mt-2 font-display text-2xl font-semibold text-[color:var(--emerald-deep)] tabular-nums">R$ 42,8k</div>
              <div className="mt-1 inline-flex items-center gap-1 text-xs text-[color:var(--emerald-deep)]">
                <TrendingDown className="h-3 w-3" /> −18%
              </div>
            </div>
            <div className="rounded-2xl bg-white/70 p-5 backdrop-blur-md shadow-[0_10px_30px_-15px_oklch(0.30_0.08_165/0.25)]">
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[color:var(--emerald-deep)]">Margem</div>
              <div className="mt-2 font-display text-2xl font-semibold text-[color:var(--emerald-deep)] tabular-nums">67,4%</div>
              <div className="mt-1 inline-flex items-center gap-1 text-xs text-[color:var(--emerald-deep)]">
                <TrendingUp className="h-3 w-3" /> +4,2pp
              </div>
            </div>
          </div>
        </div>

        <div className="relative text-[11px] text-[#2f4638]">
          © {new Date().getFullYear()} LeFil · Sistema interno
        </div>
      </div>


      {/* Form panel — clean */}
      <div className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-xl gradient-emerald">
              <span className="font-display text-base font-bold text-[#c9a84c]">L</span>
            </div>
            <div className="leading-tight">
              <div className="font-display text-sm font-semibold text-[#052e16]">LeFil</div>
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#2f4638]">Cost Center</div>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="font-display text-3xl font-semibold tracking-tight">Bem-vindo de volta</h2>
            <p className="text-sm text-muted-foreground">
              Entre para acompanhar seus custos em tempo real.
            </p>
          </div>

          <Button
            variant="outline"
            className="h-11 w-full justify-center gap-2"
            onClick={handleGoogle}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
            </svg>
            Continuar com Google
          </Button>

          <div className="text-center text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            ou com e-mail
          </div>

          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2 bg-muted/50">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>
            <TabsContent value="signin" className="space-y-4 pt-6">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-medium">E-mail</Label>
                  <Input id="email" type="email" placeholder="voce@lefil.com" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-xs font-medium">Senha</Label>
                    <button type="button" className="text-xs text-muted-foreground hover:text-foreground">Esqueci</button>
                  </div>
                  <Input id="password" type="password" placeholder="••••••••" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
                </div>
                <Button type="submit" className="group h-11 w-full gap-2" disabled={loading}>
                  {loading ? "Entrando..." : "Entrar no painel"}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup" className="space-y-4 pt-6">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email2" className="text-xs font-medium">E-mail</Label>
                  <Input id="email2" type="email" placeholder="voce@lefil.com" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password2" className="text-xs font-medium">Senha</Label>
                  <Input id="password2" type="password" placeholder="Mínimo 8 caracteres" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
                </div>
                <Button type="submit" className="h-11 w-full" disabled={loading}>
                  {loading ? "Criando..." : "Criar conta"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <p className="text-center text-[11px] text-muted-foreground">
            Ao continuar você concorda com as políticas internas da LeFil.
          </p>
        </div>
      </div>
    </div>
  );
}
