import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import session from "express-session";
import bcrypt from "bcryptjs";

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: string;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dev_secret_key",
      resave: false,
      saveUninitialized: false,
      cookie: { 
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000 
      },
    })
  );

  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
    next();
  };

  const requireAdmin = (req: any, res: any, next: any) => {
    if (!req.session.userId || req.session.role !== "ADMINISTRATOR") return res.status(403).json({ message: "Forbidden" });
    next();
  };

  app.post(api.auth.login.path, async (req, res) => {
    const { username, password } = api.auth.login.input.parse(req.body);
    const user = await storage.getUserByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ message: "Invalid credentials" });
    req.session.userId = user.id;
    req.session.role = user.role;
    res.json(user);
  });

  app.post(api.auth.logout.path, (req, res) => {
    req.session.destroy(() => res.json({ message: "Logged out" }));
  });

  app.get(api.auth.me.path, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not logged in" });
    res.json(await storage.getUser(req.session.userId));
  });

  app.post(api.auth.register.path, async (req, res) => {
    const input = api.auth.register.input.parse(req.body);
    if (await storage.getUserByUsername(input.username)) return res.status(400).json({ message: "Username exists" });
    const user = await storage.createUser({ ...input, password: bcrypt.hashSync(input.password, 10) });
    req.session.userId = user.id;
    req.session.role = user.role;
    res.status(201).json(user);
  });

  app.get(api.equipment.list.path, async (req, res) => {
    res.json(await storage.listEquipment(req.query.search as string, req.query.status as string));
  });

  app.post(api.equipment.create.path, requireAdmin, async (req, res) => {
    res.status(201).json(await storage.createEquipment(api.equipment.create.input.parse(req.body)));
  });

  app.get(api.rentals.list.path, requireAuth, async (req, res) => {
    res.json(await storage.listRentals());
  });

  app.post(api.rentals.create.path, requireAdmin, async (req, res) => {
    const input = api.rentals.create.input.parse(req.body);
    const equip = await storage.getEquipment(input.equipmentId);
    if (!equip || equip.status !== "AVAILABLE") return res.status(400).json({ message: "Unavailable" });
    const rental = await storage.createRental(input);
    await storage.updateEquipment(input.equipmentId, { status: "RENTED" });
    res.status(201).json(rental);
  });

  app.post(api.rentals.complete.path, requireAdmin, async (req, res) => {
    const rental = await storage.getRental(parseInt(req.params.id));
    if (!rental) return res.status(404).json({ message: "Not found" });
    await storage.updateRental(rental.id, { status: "COMPLETED", returnDate: new Date().toISOString().split('T')[0] });
    await storage.updateEquipment(rental.equipmentId, { status: "AVAILABLE" });
    res.json({ message: "Completed" });
  });

  app.get(api.jobSites.list.path, requireAuth, async (req, res) => res.json(await storage.listJobSites()));
  app.post(api.jobSites.create.path, requireAdmin, async (req, res) => res.status(201).json(await storage.createJobSite(api.jobSites.create.input.parse(req.body))));
  
  app.get(api.vendors.list.path, requireAuth, async (req, res) => res.json(await storage.listVendors()));
  app.post(api.vendors.create.path, requireAdmin, async (req, res) => res.status(201).json(await storage.createVendor(api.vendors.create.input.parse(req.body))));

  return httpServer;
}
