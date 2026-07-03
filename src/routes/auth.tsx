import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Sparkles, ShieldCheck, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Entrar — LeFil Cost Center" }] }),
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
    <div className="grid min-h-screen w-full bg-background lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 gradient-emerald" />
        <div className="absolute inset-0 opacity-40 [background:radial-gradient(700px_400px_at_20%_10%,var(--color-gold),transparent_55%),radial-gradient(600px_400px_at_100%_100%,oklch(0.4_0.12_195),transparent_60%)]" />
        <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:32px_32px]" />

        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <div className="relative grid h-11 w-11 place-items-center rounded-xl border border-white/15 bg-white/5 backdrop-blur">
              <span className="font-display text-lg font-bold text-[color:var(--color-gold)]">L</span>
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[color:var(--color-gold)] shadow-[0_0_12px_var(--color-gold)]" />
            </div>
            <div>
              <div className="font-display text-base font-semibold">LeFil</div>
              <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/60">Cost Center</div>
            </div>
          </div>

          <div className="max-w-lg space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-gold)] backdrop-blur">
              <Sparkles className="h-3 w-3" /> Inteligência de custos
            </div>
            <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight text-white xl:text-5xl">
              Uma sala de comando para o<br />
              <span className="text-[color:var(--color-gold)]">consumo das suas plataformas.</span>
            </h1>
            <p className="max-w-md text-[15px] leading-relaxed text-white/70">
              Consolide IA, infraestrutura e serviços em um único painel. Descubra onde cada real é
              gasto — e onde ele pode render mais.
            </p>

            <div className="grid gap-3 pt-4">
              {[
                { icon: Zap, text: "Sincronização automática de fornecedores" },
                { icon: ShieldCheck, text: "Atribuição por plataforma e cliente" },
                { icon: Sparkles, text: "Preparado para billing, créditos e assinaturas" },
              ].map((f) => (
                <div key={f.text} className="flex items-center gap-3 text-sm text-white/80">
                  <div className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5">
                    <f.icon className="h-3.5 w-3.5 text-[color:var(--color-gold)]" />
                  </div>
                  {f.text}
                </div>
              ))}
            </div>
          </div>

          <div className="text-[11px] text-white/40">
            © {new Date().getFullYear()} LeFil · Sistema interno
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-md space-y-8">
          <div className="lg:hidden">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl gradient-emerald text-[color:var(--color-gold)]">
                <span className="font-display text-base font-bold">L</span>
              </div>
              <div>
                <div className="font-display text-sm font-semibold">LeFil</div>
                <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Cost Center</div>
              </div>
            </div>
          </div>

          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">Acesse o painel</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Entre com seu e-mail LeFil para continuar.
            </p>
          </div>

          <Button variant="outline" className="w-full justify-center gap-2 border-border/70 bg-muted/30 py-5" onClick={handleGoogle}>
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
            </svg>
            Continuar com Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border/70" /></div>
            <div className="relative flex justify-center"><span className="bg-background px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">ou com e-mail</span></div>
          </div>

          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2 bg-muted/40">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>
            <TabsContent value="signin" className="space-y-4 pt-5">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">E-mail</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Senha</Label>
                  <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
                </div>
                <Button type="submit" className="group h-11 w-full gap-2" disabled={loading}>
                  {loading ? "Entrando..." : "Entrar no painel"}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup" className="space-y-4 pt-5">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email2" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">E-mail</Label>
                  <Input id="email2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password2" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Senha</Label>
                  <Input id="password2" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
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
