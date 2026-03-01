import { z } from "zod";

/**
 * Server-side environment validation.
 * Fails fast at startup if required variables are missing.
 * See .env.example for all variables.
 */
const serverEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string(),

  // Auth
  NEXTAUTH_SECRET: z.string().min(16, "NEXTAUTH_SECRET must be at least 16 characters"),
  NEXTAUTH_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),

  // Internal API
  INTERNAL_API_SECRET: z.string().min(16, "INTERNAL_API_SECRET must be at least 16 characters"),

  // Encryption (AES-256-GCM for bot API keys — DEC-0013)
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),

  // Node environment
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

/**
 * Client-side environment validation.
 * Only NEXT_PUBLIC_ variables are accessible on the client.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_GATEWAY_URL: z.string(),
});

// Validate and export server env
export const serverEnv = serverEnvSchema.parse(process.env);

// Client env is validated lazily (only when accessed in client components)
export function getClientEnv() {
  return clientEnvSchema.parse({
    NEXT_PUBLIC_GATEWAY_URL: process.env.NEXT_PUBLIC_GATEWAY_URL,
  });
}
