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
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) {
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.username = user.username;
        token.displayName = user.displayName;
        token.email = user.email;
      }
      return token;
    },

    async session({ session, token }) {
      session.user = {
        id: token.sub,
        username: token.username,
        displayName: token.displayName,
        email: token.email,
      };
      return session;
    },
  },

  pages: {
    signIn: "/login",
    newUser: "/register",
  },

  secret: process.env.NEXTAUTH_SECRET,
};
