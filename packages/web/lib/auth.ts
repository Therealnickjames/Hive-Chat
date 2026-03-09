/**
 * NextAuth.js configuration
 * Uses JWT strategy for cross-service auth (see docs/DECISIONS.md DEC-0003)
 * JWT structure matches PROTOCOL.md §6: {sub, username, displayName, email, iat, exp}
 */

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },

  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          console.log("[AUTH] authorize: missing email or password");
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) {
          console.log("[AUTH] authorize: no user found");
          return null;
        }

        const isValid = await bcrypt.compare(
          credentials.password,
          user.password,
        );
        if (!isValid) {
          console.log("[AUTH] authorize: invalid password");
          return null;
        }

        console.log(`[AUTH] authorize: success for user ${user.id}`);
        return {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          status: user.status,
          theme: user.theme,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user, trigger, session: updateData }) {
      if (user) {
        token.sub = user.id;
        token.username = user.username;
        token.displayName = user.displayName;
        token.email = user.email;
        token.avatarUrl = user.avatarUrl;
        token.status = user.status;
        token.theme = user.theme;
      }
      // Support session.update() to refresh profile data without re-login
      if (trigger === "update" && updateData) {
        if (updateData.displayName) token.displayName = updateData.displayName;
        if (updateData.email) token.email = updateData.email;
        if (updateData.avatarUrl !== undefined)
          token.avatarUrl = updateData.avatarUrl;
        if (updateData.status) token.status = updateData.status;
        if (updateData.theme) token.theme = updateData.theme;
      }
      return token;
    },

    async session({ session, token }) {
      session.user = {
        id: token.sub,
        username: token.username,
        displayName: token.displayName,
        email: token.email,
        avatarUrl: token.avatarUrl,
        status: token.status,
        theme: token.theme,
      };
      return session;
    },
  },

  pages: {
    signIn: "/login",
    newUser: "/register",
  },

  // Explicitly disable secure cookies when running over HTTP (Docker dev/CI).
  // NextAuth auto-detects from NEXTAUTH_URL but NODE_ENV=production in Docker
  // can cause ambiguity. This ensures session cookies work over plain HTTP.
  useSecureCookies: process.env.NEXTAUTH_URL?.startsWith("https://") ?? false,

  // Suppress JWT_SESSION_ERROR noise caused by stale cookies after secret rotation.
  // These are expected on fresh deploys and don't indicate a real problem —
  // users are simply redirected to login.
  logger: {
    error(code, metadata) {
      if (code === "JWT_SESSION_ERROR") return;
      console.error(`[auth] ${code}`, metadata);
    },
    warn(code) {
      console.warn(`[auth] ${code}`);
    },
    debug(code, metadata) {
      if (process.env.AUTH_DEBUG === "true") {
        console.debug(`[auth] ${code}`, metadata);
      }
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};
