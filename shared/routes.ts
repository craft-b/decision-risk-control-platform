import { z } from 'zod';
import { 
  insertEquipmentSchema, insertRentalSchema, insertUserSchema, 
  insertJobSiteSchema, insertVendorSchema, insertInvoiceSchema,
  equipment, rentals, users, jobSites, vendors, invoices 
} from './schema';

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
        200: z.custom<User>(),
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
        200: z.custom<User>(),
        401: errorSchemas.unauthorized,
      },
    },
    register: {
      method: 'POST' as const,
      path: '/api/auth/register',
      input: insertUserSchema,
      responses: {
        201: z.custom<User>(),
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
        status: z.string().optional(),
        category: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<Equipment>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/equipment/:id',
      responses: {
        200: z.custom<Equipment>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/equipment',
      input: insertEquipmentSchema,
      responses: {
        201: z.custom<Equipment>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/equipment/:id',
      input: insertEquipmentSchema.partial(),
      responses: {
        200: z.custom<Equipment>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/equipment/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    }
  },
  jobSites: {
    list: {
      method: 'GET' as const,
      path: '/api/job-sites',
      responses: { 200: z.array(z.custom<JobSite>()) },
    },
    create: {
      method: 'POST' as const,
      path: '/api/job-sites',
      input: insertJobSiteSchema,
      responses: { 201: z.custom<JobSite>() },
    },
  },
  vendors: {
    list: {
      method: 'GET' as const,
      path: '/api/vendors',
      responses: { 200: z.array(z.custom<Vendor>()) },
    },
    create: {
      method: 'POST' as const,
      path: '/api/vendors',
      input: insertVendorSchema,
      responses: { 201: z.custom<Vendor>() },
    },
  },
  rentals: {
    list: {
      method: 'GET' as const,
      path: '/api/rentals',
      input: z.object({
        search: z.string().optional(),
        jobSiteId: z.string().optional(),
        vendorId: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<Rental & { equipment: Equipment, jobSite: JobSite, vendor: Vendor | null }>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/rentals',
      input: insertRentalSchema,
      responses: {
        201: z.custom<Rental>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/rentals/:id',
      responses: {
        200: z.custom<Rental & { equipment: Equipment, jobSite: JobSite, vendor: Vendor | null, invoices: Invoice[] }>(),
        404: errorSchemas.notFound,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/rentals/:id',
      input: insertRentalSchema.partial(),
      responses: {
        200: z.custom<Rental>(),
        404: errorSchemas.notFound,
      },
    },
  },
  invoices: {
    create: {
      method: 'POST' as const,
      path: '/api/invoices',
      input: insertInvoiceSchema,
      responses: { 201: z.custom<Invoice>() },
    },
  },
  reports: {
    weeklyOutstanding: {
      method: 'GET' as const,
      path: '/api/reports/weekly-outstanding',
      responses: { 200: z.array(z.any()) },
    },
    buyoutCandidates: {
      method: 'GET' as const,
      path: '/api/reports/buyout-candidates',
      responses: { 200: z.array(z.any()) },
    },
    annualRental: {
      method: 'GET' as const,
      path: '/api/reports/annual-rental',
      responses: { 200: z.array(z.any()) },
    },
  }
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

// Re-export types from schema
import { User, Equipment, Rental, JobSite, Vendor, Invoice } from './schema';
