# Smash & Craft Construction Rental Equipment System

## Overview

This is a full-stack equipment rental management system for the construction industry. The application allows users to track rental equipment inventory, manage active rentals, and view dashboard analytics. It features role-based access control with Administrator and Viewer roles, session-based authentication, and a modern React frontend with an Express backend.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **React 18 with TypeScript** - Single-page application using Vite as the build tool
- **Wouter** for client-side routing (lightweight alternative to React Router)
- **TanStack Query (React Query)** for server state management and data fetching
- **Shadcn/UI** component library built on Radix UI primitives with Tailwind CSS styling
- **React Hook Form + Zod** for form validation with shared schemas between client and server

The frontend follows a structured pattern:
- Pages in `client/src/pages/` for route-level components
- Reusable components in `client/src/components/`
- Custom hooks in `client/src/hooks/` for data fetching and authentication
- UI components in `client/src/components/ui/` (Shadcn/UI)

### Backend Architecture
- **Express.js with TypeScript** - RESTful API server
- **Drizzle ORM** with PostgreSQL for database operations
- **Session-based authentication** using express-session with bcryptjs for password hashing
- **Layered architecture** with routes, storage layer, and database connection separated

Key backend files:
- `server/routes.ts` - API route definitions with authentication middleware
- `server/storage.ts` - Database access layer implementing IStorage interface
- `server/db.ts` - Drizzle ORM database connection
- `shared/schema.ts` - Database schema definitions shared with frontend
- `shared/routes.ts` - API contract definitions with Zod validation

### Authentication & Authorization
- Session-based auth stored server-side with express-session
- Role-Based Access Control (RBAC) with ADMINISTRATOR and VIEWER roles
- Protected routes using `requireAuth` and `requireAdmin` middleware
- Password hashing with bcryptjs

### Data Model
Three main entities defined in `shared/schema.ts`:
- **Users** - Authentication with role-based permissions
- **Equipment** - Inventory items with status (AVAILABLE, RENTED, MAINTENANCE)
- **Rentals** - Rental transactions linking equipment to customers

### Build System
- Development: Vite dev server with HMR, proxied through Express
- Production: Vite builds static assets, esbuild bundles server code
- Scripts: `npm run dev` for development, `npm run build` for production build

## External Dependencies

### Database
- **PostgreSQL** - Primary database via `DATABASE_URL` environment variable
- **Drizzle ORM** - Type-safe database queries and migrations
- **Drizzle Kit** - Database schema push with `npm run db:push`

### Authentication
- **express-session** - Server-side session management
- **bcryptjs** - Password hashing

### UI Components
- **Radix UI** - Headless UI primitives (dialog, dropdown, tabs, etc.)
- **Tailwind CSS** - Utility-first styling
- **Recharts** - Dashboard charts and visualizations
- **date-fns** - Date formatting utilities
- **Lucide React** - Icon library

### Development Tools
- **Vite** - Frontend build tool with React plugin
- **TypeScript** - Type checking across full stack
- **esbuild** - Server bundling for production