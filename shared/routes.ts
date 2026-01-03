import { z } from 'zod';
import { insertEquipmentSchema, insertRentalSchema, insertUserSchema, equipment, rentals, users } from './schema';

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  auth: {
    login: {
      method: 'POST' as const,
      path: '/api/auth/login',
      input: z.object({
        username: z.string(),
        password: z.string(),
      }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.unauthorized,
      },
    },
    logout: {
      method: 'POST' as const,
      path: '/api/auth/logout',
      responses: {
        200: z.object({ message: z.string() }),
      },
    },
    me: {
      method: 'GET' as const,
      path: '/api/auth/me',
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.unauthorized,
      },
    },
    register: {
      method: 'POST' as const,
      path: '/api/auth/register',
      input: insertUserSchema,
      responses: {
        201: z.custom<typeof users.$inferSelect>(),
        400: errorSchemas.validation,
      },
    }
  },
  equipment: {
    list: {
      method: 'GET' as const,
      path: '/api/equipment',
      input: z.object({
        search: z.string().optional(),
        status: z.enum(["AVAILABLE", "RENTED", "MAINTENANCE"]).optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof equipment.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/equipment/:id',
      responses: {
        200: z.custom<typeof equipment.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/equipment',
      input: insertEquipmentSchema,
      responses: {
        201: z.custom<typeof equipment.$inferSelect>(),
        400: errorSchemas.validation,
        403: errorSchemas.unauthorized,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/equipment/:id',
      input: insertEquipmentSchema.partial(),
      responses: {
        200: z.custom<typeof equipment.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
        403: errorSchemas.unauthorized,
      },
    },
  },
  rentals: {
    list: {
      method: 'GET' as const,
      path: '/api/rentals',
      responses: {
        200: z.array(z.custom<typeof rentals.$inferSelect & { equipment: typeof equipment.$inferSelect }>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/rentals',
      input: insertRentalSchema,
      responses: {
        201: z.custom<typeof rentals.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    complete: {
      method: 'POST' as const,
      path: '/api/rentals/:id/complete',
      input: z.object({
        endDate: z.string(),
        notes: z.string().optional(),
      }),
      responses: {
        200: z.custom<typeof rentals.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
