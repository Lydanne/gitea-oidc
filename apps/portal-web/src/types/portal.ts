export interface PortalUser {
  sub: string;
  username?: string;
  name?: string;
  email?: string;
  emailVerified?: boolean;
  picture?: string;
  groups?: unknown[];
  roles?: string[];
}

export interface PortalSession {
  user: PortalUser;
  admin: boolean;
  basePath: string;
  adminBasePath: string;
}

export interface PortalApplication {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  launchUrl: string;
  order: number;
}
