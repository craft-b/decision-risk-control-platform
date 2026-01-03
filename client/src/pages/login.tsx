import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Truck, Loader2 } from "lucide-react";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { loginMutation, user } = useAuth();
  const [, setLocation] = useLocation();

  if (user) {
    setLocation("/");
    return null;
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ username, password });
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: Branding */}
      <div className="hidden lg:flex flex-col bg-slate-900 text-white p-12 justify-between relative overflow-hidden">
        <div className="z-10">
          <div className="flex items-center gap-2 mb-8">
            <Truck className="h-10 w-10 text-primary" />
            <span className="text-2xl font-bold font-display tracking-widest text-primary">MOSITES</span>
          </div>
          <h1 className="text-5xl font-bold mb-6 leading-tight">
            Building the Future <br/>
            <span className="text-primary">One Rental at a Time.</span>
          </h1>
          <p className="text-slate-400 text-lg max-w-md">
            Professional equipment management system for the modern construction industry. Track assets, manage rentals, and optimize utilization.
          </p>
        </div>

        {/* Decorative background circle */}
        <div className="absolute -bottom-48 -right-48 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
        <div className="absolute top-24 right-24 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl" />
        
        {/* Unsplash Image as subtle background */}
        {/* Construction crane silhouette sunset */}
        <div 
          className="absolute inset-0 opacity-10 mix-blend-overlay z-0"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1541888946425-d81bb19240f5?q=80&w=2070&auto=format&fit=crop')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
        />

        <div className="z-10 text-sm text-slate-500">
          © 2024 Mosites Construction Co. All rights reserved.
        </div>
      </div>

      {/* Right: Login Form */}
      <div className="flex items-center justify-center p-8 bg-slate-50">
        <Card className="w-full max-w-md shadow-xl border-slate-200">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">Sign in</CardTitle>
            <CardDescription className="text-center">
              Enter your credentials to access the dashboard
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input 
                  id="username" 
                  placeholder="admin" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loginMutation.isPending}
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
                  disabled={loginMutation.isPending}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                type="submit" 
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </CardFooter>
          </form>
          <div className="px-8 pb-8 text-center text-xs text-muted-foreground">
             <p>Demo Credentials:</p>
             <p>Admin: <span className="font-mono">admin / admin</span></p>
             <p>Viewer: <span className="font-mono">viewer / viewer</span></p>
          </div>
        </Card>
      </div>
    </div>
  );
}
