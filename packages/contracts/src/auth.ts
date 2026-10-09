import { z } from 'zod';
import { dateTime, id, localeSchema, passwordSchema } from './common';

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(256),
  /** Key of an LDAP provider; omitted = local account. */
  provider: z.string().max(64).optional(),
  remember: z.boolean().default(false),
});
export type LoginInput = z.input<typeof loginSchema>;

export const authProviderPublicSchema = z.object({
  key: z.string(),
  name: z.string(),
  type: z.enum(['oidc', 'saml', 'ldap']),
  /** Where the browser goes to start SSO (OIDC/SAML); LDAP uses the password form. */
  startUrl: z.string().nullable(),
});
export type AuthProviderPublic = z.input<typeof authProviderPublicSchema>;

export const grantSchema = z.union([
  z.object({ p: z.string(), s: z.literal('g') }),
  z.object({ p: z.string(), s: z.literal('d'), d: z.array(z.string()) }),
  z.object({ p: z.string(), s: z.literal('r'), t: z.string(), id: z.string() }),
]);

export const meSchema = z.object({
  id,
  email: z.string(),
  username: z.string(),
  displayName: z.string(),
  locale: localeSchema,
  timezone: z.string(),
  departmentId: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  jobTitle: z.string().nullable(),
  authSource: z.string(),
  mustChangePassword: z.boolean(),
  preferences: z.object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    sidebarCollapsed: z.boolean().optional(),
    /** Sidebar groups the person keeps open (navigation ids). */
    navExpanded: z.array(z.string()).optional(),
  }),
});
export type Me = z.input<typeof meSchema>;

export const sessionResponseSchema = z.object({
  user: meSchema,
  csrfToken: z.string(),
  grants: z.array(grantSchema),
  enabledModules: z.array(z.string()),
  expiresAt: dateTime,
});
export type SessionResponse = z.input<typeof sessionResponseSchema>;

export const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  locale: localeSchema.optional(),
  timezone: z.string().max(64).optional(),
  preferences: z
    .object({
      theme: z.enum(['light', 'dark', 'system']).optional(),
      sidebarCollapsed: z.boolean().optional(),
      navExpanded: z.array(z.string().max(120)).max(40).optional(),
    })
    .optional(),
});
export type UpdateMeInput = z.input<typeof updateMeSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
