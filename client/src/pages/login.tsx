import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { BrandMark } from "@/components/brand";

import landingImg from "@assets/pexels-apasaric-1238864_1767415604985.jpg";

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { loginMutation, registerMutation, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user) {
      setLocation("/");
    }
  }, [user, setLocation]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegister) {
      registerMutation.mutate({ username, password } as any);
    } else {
      loginMutation.mutate({ username, password });
    }
  };

  const isPending = loginMutation.isPending || registerMutation.isPending;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left: brand panel — always dark, regardless of theme. Neutral
          near-black (no navy cast) per the design system. */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-zinc-950 p-12 text-white lg:flex">
        {/* Background image, held down by a neutral wash so type stays primary */}
        <div
          className="absolute inset-0 z-0 opacity-30"
          style={{
            backgroundImage: `url(${landingImg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="absolute inset-0 z-[1] bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-zinc-950/70" />

        <div className="z-10">
          <div className="mb-16 flex items-center gap-3">
            <BrandMark className="h-9 w-9 text-white" />
            <div className="leading-none">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Craft &amp; Smash
              </p>
              <p className="mt-1 text-[15px] font-semibold tracking-tight text-white">
                Asset Intelligence
              </p>
            </div>
          </div>

          <h1 className="max-w-lg text-4xl font-semibold leading-[1.15] tracking-tight text-white">
            Know which machine fails next —
            <span className="text-zinc-500"> before it costs you the jobsite.</span>
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-zinc-400">
            Calibrated multi-horizon failure prediction, dispatch risk guarding, and
            maintenance economics for mixed construction fleets — one risk model across
            every make on the yard.
          </p>

          <div className="mt-12 flex gap-10 text-sm">
            <div className="border-l border-zinc-800 pl-4">
              <p className="font-mono text-xl font-semibold tabular-nums text-white">3</p>
              <p className="mt-0.5 text-zinc-500">prediction horizons</p>
            </div>
            <div className="border-l border-zinc-800 pl-4">
              <p className="font-mono text-xl font-semibold tabular-nums text-white">10 / 30 / 60d</p>
              <p className="mt-0.5 text-zinc-500">failure windows</p>
            </div>
            <div className="border-l border-zinc-800 pl-4">
              <p className="font-mono text-xl font-semibold tabular-nums text-white">31</p>
              <p className="mt-0.5 text-zinc-500">engineered features</p>
            </div>
          </div>
        </div>

        <div className="z-10 flex items-center justify-between text-xs text-zinc-600">
          <span>© 2026 Craft &amp; Smash Rental Systems</span>
          <span className="font-mono">calibrated · leakage-tested · shap-explained</span>
        </div>
      </div>

      {/* Right: auth form */}
      <div className="flex items-center justify-center bg-background p-8">
        <div className="w-full max-w-md">
          {/* Mobile-only brand header */}
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <BrandMark className="h-8 w-8 text-foreground" />
            <span className="text-lg font-semibold tracking-tight">Asset Intelligence</span>
          </div>

          <Card className="card-sheen">
            <CardHeader className="space-y-1">
              <CardTitle className="text-center text-xl">
                {isRegister ? "Create an account" : "Sign in"}
              </CardTitle>
              <CardDescription className="text-center">
                {isRegister
                  ? "Enter your details to register"
                  : "Enter your credentials to access the fleet"}
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    placeholder="admin"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isPending}
                    autoComplete="username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isPending}
                    autoComplete={isRegister ? "new-password" : "current-password"}
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col space-y-4">
                <Button
                  type="submit"
                  className="w-full font-semibold"
                  disabled={isPending}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {isRegister ? "Registering..." : "Authenticating..."}
                    </>
                  ) : (
                    isRegister ? "Register" : "Sign In"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-primary text-xs hover:bg-transparent no-default-hover-elevate"
                  onClick={() => setIsRegister(!isRegister)}
                  disabled={isPending}
                >
                  {isRegister
                    ? "Already have an account? Sign in"
                    : "Don't have an account? Register now"}
                </Button>
              </CardFooter>
            </form>
            {!isRegister && (
              <div className="mx-8 mb-8 rounded-md border border-border bg-muted/40 px-4 py-3 text-center text-xs text-muted-foreground">
                <p className="mb-1 font-medium uppercase tracking-wider text-[10px]">Demo access</p>
                <p>Admin: <span className="font-mono text-foreground/80">admin / admin123</span></p>
                <p>Viewer: <span className="font-mono text-foreground/80">viewer / viewer123</span></p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
