import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    id: string;
    username: string;
    displayName: string;
    email: string;
    avatarUrl?: string | null;
    status?: string;
    theme?: string;
  }

  interface Session {
    user: {
      id: string;
      username: string;
      displayName: string;
      email: string;
      avatarUrl?: string | null;
      status?: string;
      theme?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub: string;
    username: string;
    displayName: string;
    email: string;
    avatarUrl?: string | null;
    status?: string;
    theme?: string;
  }
}
