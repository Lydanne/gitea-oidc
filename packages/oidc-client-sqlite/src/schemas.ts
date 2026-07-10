import type { LoginTransaction, SensitiveAuthSessionRecord } from "@gitea-oidc/node";
import { z } from "zod";
import { sqliteStoreError } from "./errors.js";

const ownerNamespaceSchema = z.string().regex(/^owner-v1:[A-Za-z0-9_-]{43}$/u);
const opaqueValueSchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u);
const timestampSchema = z.number().int().nonnegative();
const exactString = (maximum: number) => z.string().min(1).max(maximum);
const stringList = (maximumItems: number, maximumLength: number) =>
  z.array(exactString(maximumLength)).max(maximumItems);

const authUserProfileSchema = z
  .object({
    subject: exactString(512),
    name: exactString(2_048).optional(),
    preferredUsername: exactString(512).optional(),
    email: exactString(2_048).optional(),
    emailVerified: z.boolean().optional(),
    picture: exactString(8_192).optional(),
    groups: stringList(512, 1_024).optional(),
  })
  .strict();

const tokenSetSchema = z
  .object({
    accessToken: exactString(65_536),
    tokenType: z.literal("Bearer"),
    refreshToken: exactString(65_536).optional(),
    idToken: exactString(65_536).optional(),
    accessTokenExpiresAt: timestampSchema.optional(),
  })
  .strict();

export const loginTransactionSchema = z
  .object({
    ownerNamespace: ownerNamespaceSchema,
    transactionId: opaqueValueSchema,
    state: opaqueValueSchema,
    nonce: opaqueValueSchema,
    codeVerifier: opaqueValueSchema,
    redirectUri: z.url().max(8_192),
    returnTo: z.string().min(1).max(2_048),
    scopes: stringList(128, 255),
    resources: stringList(128, 8_192),
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict()
  .superRefine((transaction, context) => {
    if (transaction.expiresAt <= transaction.createdAt) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "expiresAt 必须晚于 createdAt",
      });
    }
  });

export const authSessionSchema = z
  .object({
    ownerNamespace: ownerNamespaceSchema,
    sessionId: opaqueValueSchema,
    subject: exactString(512),
    user: authUserProfileSchema,
    scopes: stringList(128, 255),
    resources: stringList(128, 8_192),
    tokens: tokenSetSchema,
    refreshVersion: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict()
  .superRefine((session, context) => {
    if (
      session.user.subject !== session.subject ||
      session.updatedAt < session.createdAt ||
      session.expiresAt <= session.createdAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Session 时间或 subject 关系无效",
      });
    }
  });

const parseStoredValue = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw sqliteStoreError("CORRUPTED_DATA");
  }
  return result.data;
};

export const parseLoginTransaction = (input: unknown): LoginTransaction =>
  parseStoredValue(loginTransactionSchema, input);

export const parseAuthSession = (input: unknown): SensitiveAuthSessionRecord =>
  parseStoredValue(authSessionSchema, input);
