import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Truck, Loader2 } from "lucide-react";

import landingImg from "@assets/pexels-apasaric-1238864_1767415604985.jpg";

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { loginMutation, registerMutation, user } = useAuth();
  const [, setLocation] = useLocation();

  if (user) {
    setLocation("/");
    return null;
  }

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
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: Branding */}
      <div className="hidden lg:flex flex-col bg-slate-900 text-white p-12 justify-between relative overflow-hidden">
        {/* Dark Wash Overlay */}
        <div className="absolute inset-0 bg-black/40 z-[1]" />
        
        <div className="z-10">
          <div className="flex items-center gap-2 mb-8">
            <Truck className="h-10 w-10 text-primary" />
            <span className="text-2xl font-bold font-display tracking-widest text-primary">MOSITES</span>
          </div>
          <h1 className="text-5xl font-bold mb-6 leading-tight">
            Building the Future <br/>
            <span className="text-primary">One Rental at a Time.</span>
          </h1>
          <p className="text-slate-100 text-lg max-w-md">
            Professional equipment management system for the modern construction industry. Track assets, manage rentals, and optimize utilization.
          </p>
        </div>

        {/* Decorative background circle */}
        <div className="absolute -bottom-48 -right-48 w-96 h-96 bg-primary/20 rounded-full blur-3xl z-[1]" />
        <div className="absolute top-24 right-24 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl z-[1]" />
        
        {/* Background Image */}
        <div 
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url(${landingImg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
        />

        <div className="z-10 text-sm text-slate-300">
          © 2024 Mosites Construction Co. All rights reserved.
        </div>
      </div>

      {/* Right: Auth Form */}
      <div className="flex items-center justify-center p-8 bg-slate-50">
        <Card className="w-full max-w-md shadow-xl border-slate-200">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">
              {isRegister ? "Create an account" : "Sign in"}
            </CardTitle>
            <CardDescription className="text-center">
              {isRegister 
                ? "Enter your details to register" 
                : "Enter your credentials to access the dashboard"}
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
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col space-y-4">
              <Button 
                type="submit" 
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
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
                className="text-primary text-xs hover:bg-transparent"
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
            <div className="px-8 pb-8 text-center text-xs text-muted-foreground">
               <p>Demo Credentials:</p>
               <p>Admin: <span className="font-mono">admin / admin123</span></p>
               <p>Viewer: <span className="font-mono">viewer / viewer123</span></p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
