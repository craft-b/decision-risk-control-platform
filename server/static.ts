import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "..", "dist", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Production build not found at ${distPath}. Run "npm run build" first.`
    );
  }

  // Serve static assets with long cache
  app.use(
    "/assets",
    (req, res, next) => {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      next();
    },
    express.static(path.join(distPath, "assets"))
  );

  // Serve remaining static files
  app.use(express.static(distPath));

  // SPA fallback — all unmatched routes serve index.html
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}