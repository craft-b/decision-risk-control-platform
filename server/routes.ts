import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import session from "express-session";
import bcrypt from "bcryptjs";
import { insertUserSchema } from "@shared/schema";

// Extend express session
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

  // Session Setup
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dev_secret_key",
      resave: false,
      saveUninitialized: false,
      cookie: { 
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      },
    })
  );

  // Helper for protected routes
  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  };

  const requireAdmin = (req: any, res: any, next: any) => {
    if (!req.session.userId || req.session.role !== "ADMINISTRATOR") {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };


  // === AUTH ROUTES ===

  app.post(api.auth.login.path, async (req, res) => {
    try {
      const { username, password } = api.auth.login.input.parse(req.body);
      const user = await storage.getUserByUsername(username);
      
      if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      req.session.userId = user.id;
      req.session.role = user.role;
      res.json(user);
    } catch (error) {
       res.status(400).json({ message: "Invalid request" });
    }
  });

  app.post(api.auth.logout.path, (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });

  app.get(api.auth.me.path, async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not logged in" });
    }
    const user = await storage.getUser(req.session.userId);
    res.json(user);
  });


  // === EQUIPMENT ROUTES ===

  app.get(api.equipment.list.path, async (req, res) => {
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const items = await storage.listEquipment(search, status);
    res.json(items);
  });

  app.get(api.equipment.get.path, async (req, res) => {
    const id = parseInt(req.params.id);
    const item = await storage.getEquipment(id);
    if (!item) return res.status(404).json({ message: "Equipment not found" });
    res.json(item);
  });

  app.post(api.equipment.create.path, requireAdmin, async (req, res) => {
    try {
      const input = api.equipment.create.input.parse(req.body);
      const item = await storage.createEquipment(input);
      res.status(201).json(item);
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json({ message: e.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.put(api.equipment.update.path, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
      const input = api.equipment.update.input.parse(req.body);
      const item = await storage.updateEquipment(id, input);
      if (!item) return res.status(404).json({ message: "Equipment not found" });
      res.json(item);
    } catch (e) {
      res.status(400).json({ message: "Validation error" });
    }
  });


  // === RENTAL ROUTES ===

  app.get(api.rentals.list.path, requireAuth, async (req, res) => {
    const items = await storage.listRentals();
    res.json(items);
  });

  app.post(api.rentals.create.path, requireAdmin, async (req, res) => {
    try {
      const input = api.rentals.create.input.parse(req.body);
      
      // Check availability
      const equipment = await storage.getEquipment(input.equipmentId);
      if (!equipment || equipment.status !== "AVAILABLE") {
         return res.status(400).json({ message: "Equipment not available" });
      }

      // Create rental
      const rental = await storage.createRental(input);
      
      // Update equipment status
      await storage.updateEquipment(input.equipmentId, { status: "RENTED" });
      
      res.status(201).json(rental);
    } catch (e) {
      res.status(400).json({ message: "Validation error" });
    }
  });

  app.post(api.rentals.complete.path, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { endDate, notes } = req.body; // Validation could be stricter here

    try {
      // Get rental to find equipment
      const rentals = await storage.listRentals();
      const rental = rentals.find(r => r.id === id);
      if (!rental) return res.status(404).json({ message: "Rental not found" });

      // Update rental
      const updatedRental = await storage.updateRental(id, { 
        status: "COMPLETED",
        endDate: endDate,
        notes: notes ? (rental.notes + "\n" + notes) : rental.notes
      });

      // Update equipment status
      if (rental.equipmentId) {
        await storage.updateEquipment(rental.equipmentId, { status: "AVAILABLE" });
      }

      res.json(updatedRental);
    } catch (e) {
      res.status(500).json({ message: "Error completing rental" });
    }
  });

  // Seed Data
  if (process.env.NODE_ENV !== "production") {
    const existingUsers = await storage.getUserByUsername("admin");
    if (!existingUsers) {
      console.log("Seeding database...");
      const hashedPassword = bcrypt.hashSync("admin123", 10);
      await storage.createUser({
        username: "admin",
        password: hashedPassword,
        role: "ADMINISTRATOR"
      });
      
      const viewerPass = bcrypt.hashSync("viewer123", 10);
      await storage.createUser({
        username: "viewer",
        password: viewerPass,
        role: "VIEWER"
      });

      await storage.createEquipment({
        name: "Caterpillar 320 Excavator",
        category: "Excavator",
        status: "AVAILABLE",
        dailyRate: "500.00",
        serialNumber: "CAT-320-001",
        location: "Yard A"
      });
      
      await storage.createEquipment({
        name: "JLG 450AJ Boom Lift",
        category: "Lift",
        status: "RENTED",
        dailyRate: "250.00",
        serialNumber: "JLG-450-002",
        location: "Job Site B"
      });
    }
  }

  return httpServer;
}
