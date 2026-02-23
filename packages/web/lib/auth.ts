/**
 * NextAuth.js configuration
 * Uses JWT strategy for cross-service auth (see docs/DECISIONS.md DEC-0003)
 *
 * TODO: Implement full auth in TASK-0002
 * This is a placeholder showing the JWT strategy configuration.
 */

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

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
        // TODO: Implement actual credential validation in TASK-0002
        // 1. Look up user by email
        // 2. Compare bcrypt hash
        // 3. Return user object or null
        return null;
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      // On sign-in, add custom claims from the user object
      if (user) {
        token.sub = user.id;
        // TODO: Add username, displayName from User model
      }
      return token;
    },

    async session({ session, token }) {
      // Expose custom claims in the session
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
    newUser: "/register",
  },

  secret: process.env.NEXTAUTH_SECRET,
};
