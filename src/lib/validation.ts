import { z } from 'zod';

export const idParam = z.coerce.number().int().positive();

const password = z
  .string()
  .min(8, 'must be at least 8 characters')
  .max(100)
  .regex(/[A-Za-z]/, 'must contain a letter')
  .regex(/[0-9]/, 'must contain a digit');

export const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(100),
});

export const createUserSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255),
  password,
  role: z.enum(['admin', 'reviewer', 'client']),
});

export const updateUserSchema = z
  .object({
    role: z.enum(['admin', 'reviewer', 'client']).optional(),
    isActive: z.boolean().optional(),
    password: password.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');

export const createCaseSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  clientId: z.coerce.number().int().positive(),
});

export const assignSchema = z.object({ userId: z.coerce.number().int().positive() });

export const issueStatusSchema = z.object({ status: z.enum(['open', 'resolved', 'dismissed']) });

const threshold = z.coerce.number().min(0).max(1);

export const createRuleSchema = z
  .object({
    ruleCode: z.string().trim().regex(/^[A-Z0-9_]{2,30}$/, 'use UPPER_CASE letters, digits and underscores'),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(1000),
    ruleType: z.enum(['required', 'restricted']),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    presentThreshold: threshold,
    standardThreshold: threshold,
  })
  .refine((v) => v.standardThreshold >= v.presentThreshold, { message: 'standardThreshold must be >= presentThreshold', path: ['standardThreshold'] });

export const updateRuleSchema = z
  .object({
    title: z.string().trim().min(3).max(120).optional(),
    description: z.string().trim().min(10).max(1000).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    presentThreshold: threshold.optional(),
    standardThreshold: threshold.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');

export const referenceSchema = z.object({
  label: z.string().trim().min(2).max(80),
  clauseText: z.string().trim().min(30).max(3000),
});

export const searchSchema = z.object({
  q: z.string().trim().min(2).max(300),
  mode: z.enum(['hybrid', 'semantic', 'keyword']).default('hybrid'),
});
