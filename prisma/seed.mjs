/**
 * Seed script for Tavok demo data.
 *
 * Creates a demo workspace with channels, bots, messages (including
 * completed bot messages with thinking timelines), reactions, mentions,
 * and unread state — everything needed for a compelling demo screenshot.
 *
 * Run: node prisma/seed.mjs
 * Or:  pnpm db:seed (after adding prisma.seed to package.json)
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "crypto";

// Resolve packages from packages/web/node_modules (pnpm workspace)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(__dirname, "..", "packages", "web");
const require = createRequire(path.join(webDir, "package.json"));

const { PrismaClient } = require("@prisma/client");
const bcryptjs = require("bcryptjs");

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Crockford Base32 for ULID
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function generateId() {
  const now = Date.now();
  // Encode 48-bit timestamp into first 10 chars
  let ts = now;
  const timePart = new Array(10);
  for (let i = 9; i >= 0; i--) {
    timePart[i] = ENCODING[ts & 31];
    ts = Math.floor(ts / 32);
  }
  // 16 random chars
  const randPart = new Array(16);
  const bytes = crypto.randomBytes(10);
  let byteIdx = 0;
  let bitBuf = 0;
  let bitsLeft = 0;
  for (let i = 0; i < 16; i++) {
    if (bitsLeft < 5) {
      bitBuf = (bitBuf << 8) | bytes[byteIdx++];
      bitsLeft += 8;
    }
    bitsLeft -= 5;
    randPart[i] = ENCODING[(bitBuf >> bitsLeft) & 31];
  }
  return timePart.join("") + randPart.join("");
}

// AES-256-GCM encryption matching packages/web/lib/encryption.ts
function encrypt(plaintext) {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be set to 64 hex characters (32 bytes)"
    );
  }
  const key = Buffer.from(hex, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

// Deterministic IDs so we can reference them across entities
const IDS = {
  // Users
  demoUser: generateId(),
  aliceUser: generateId(),
  bobUser: generateId(),

  // Server
  server: generateId(),

  // Channels
  generalChannel: generateId(),
  researchChannel: generateId(),
  devChannel: generateId(),

  // Bots
  claudeBot: generateId(),
  gptBot: generateId(),
  llamaBot: generateId(),

  // Members
  demoMember: generateId(),
  aliceMember: generateId(),
  bobMember: generateId(),

  // Roles
  adminRole: generateId(),
  memberRole: generateId(),

  // ChannelBots
  cbClaudeGeneral: generateId(),
  cbGptGeneral: generateId(),
  cbClaudeResearch: generateId(),
  cbLlamaResearch: generateId(),
  cbGptDev: generateId(),

  // Messages (we need stable IDs for reactions/mentions)
  msg1: generateId(),
  msg2: generateId(),
  msg3: generateId(),
  msg4: generateId(),
  msg5: generateId(),
  msg6: generateId(),
  msg7: generateId(),
  msg8: generateId(),
  msg9: generateId(),
  msg10: generateId(),

  // Reactions
  react1: generateId(),
  react2: generateId(),
  react3: generateId(),
  react4: generateId(),

  // Mentions
  mention1: generateId(),
  mention2: generateId(),

  // Read states
  rs1: generateId(),
  rs2: generateId(),
  rs3: generateId(),
  rs4: generateId(),
  rs5: generateId(),
  rs6: generateId(),

  // Invite
  invite1: generateId(),
};

// ---------------------------------------------------------------------------
// Main seed
// ---------------------------------------------------------------------------
async function main() {
  console.log("🌱 Seeding Tavok demo data...\n");

  // -----------------------------------------------------------------------
  // 0. Clean up previous seed data (delete servers owned by seed users)
  // -----------------------------------------------------------------------
  const seedEmails = ["demo@tavok.ai", "alice@tavok.ai", "bob@tavok.ai"];
  const existingUsers = await prisma.user.findMany({
    where: { email: { in: seedEmails } },
    select: { id: true },
  });

  if (existingUsers.length > 0) {
    const userIds = existingUsers.map((u) => u.id);
    // Delete servers owned by seed users (cascades channels, messages, bots, etc.)
    const deleted = await prisma.server.deleteMany({
      where: { ownerId: { in: userIds } },
    });
    if (deleted.count > 0) {
      console.log(`  ✓ Cleaned up ${deleted.count} previous seed server(s)`);
    }
  }

  // -----------------------------------------------------------------------
  // 1. Users
  // -----------------------------------------------------------------------
  const passwordHash = await bcryptjs.hash("DemoPass123!", 12);

  const demoUser = await prisma.user.upsert({
    where: { email: "demo@tavok.ai" },
    update: {},
    create: {
      id: IDS.demoUser,
      email: "demo@tavok.ai",
      username: "demouser",
      displayName: "Demo User",
      password: passwordHash,
    },
  });
  console.log("  ✓ User: demo@tavok.ai (password: DemoPass123!)");

  const alice = await prisma.user.upsert({
    where: { email: "alice@tavok.ai" },
    update: {},
    create: {
      id: IDS.aliceUser,
      email: "alice@tavok.ai",
      username: "alice",
      displayName: "Alice Chen",
      password: passwordHash,
    },
  });
  console.log("  ✓ User: alice@tavok.ai");

  const bob = await prisma.user.upsert({
    where: { email: "bob@tavok.ai" },
    update: {},
    create: {
      id: IDS.bobUser,
      email: "bob@tavok.ai",
      username: "bob",
      displayName: "Bob Martinez",
      password: passwordHash,
    },
  });
  console.log("  ✓ User: bob@tavok.ai");

  // -----------------------------------------------------------------------
  // 2. Server
  // -----------------------------------------------------------------------
  const server = await prisma.server.upsert({
    where: { id: IDS.server },
    update: {},
    create: {
      id: IDS.server,
      name: "AI Research Lab",
      ownerId: demoUser.id,
      allowAgentRegistration: true,
      registrationApprovalRequired: false,
    },
  });
  console.log("  ✓ Server: AI Research Lab");

  // -----------------------------------------------------------------------
  // 3. Roles
  // -----------------------------------------------------------------------
  // Admin role: all permissions (0x7FFFFFFF)
  await prisma.role.upsert({
    where: { id: IDS.adminRole },
    update: {},
    create: {
      id: IDS.adminRole,
      serverId: server.id,
      name: "Admin",
      color: "#E74C3C",
      permissions: BigInt(0x7fffffff),
      position: 1,
    },
  });

  await prisma.role.upsert({
    where: { id: IDS.memberRole },
    update: {},
    create: {
      id: IDS.memberRole,
      serverId: server.id,
      name: "Member",
      color: "#3498DB",
      permissions: BigInt(0x00000037), // basic send/read/react
      position: 0,
    },
  });
  console.log("  ✓ Roles: Admin, Member");

  // -----------------------------------------------------------------------
  // 4. Members
  // -----------------------------------------------------------------------
  await prisma.member.upsert({
    where: { userId_serverId: { userId: demoUser.id, serverId: server.id } },
    update: {},
    create: {
      id: IDS.demoMember,
      userId: demoUser.id,
      serverId: server.id,
      roles: { connect: [{ id: IDS.adminRole }] },
    },
  });

  await prisma.member.upsert({
    where: { userId_serverId: { userId: alice.id, serverId: server.id } },
    update: {},
    create: {
      id: IDS.aliceMember,
      userId: alice.id,
      serverId: server.id,
      roles: { connect: [{ id: IDS.memberRole }] },
    },
  });

  await prisma.member.upsert({
    where: { userId_serverId: { userId: bob.id, serverId: server.id } },
    update: {},
    create: {
      id: IDS.bobMember,
      userId: bob.id,
      serverId: server.id,
      roles: { connect: [{ id: IDS.memberRole }] },
    },
  });
  console.log("  ✓ Members: Demo User (Admin), Alice, Bob");

  // -----------------------------------------------------------------------
  // 5. Bots
  // -----------------------------------------------------------------------
  const placeholderKey = encrypt("sk-demo-placeholder-key-not-real");

  const claudeBot = await prisma.bot.upsert({
    where: { id: IDS.claudeBot },
    update: {},
    create: {
      id: IDS.claudeBot,
      name: "Claude",
      serverId: server.id,
      llmProvider: "anthropic",
      llmModel: "claude-sonnet-4-20250514",
      apiEndpoint: "https://api.anthropic.com/v1/messages",
      apiKeyEncrypted: placeholderKey,
      systemPrompt:
        "You are Claude, a helpful AI assistant by Anthropic. Be concise, thoughtful, and accurate.",
      temperature: 0.7,
      maxTokens: 4096,
      isActive: true,
      triggerMode: "ALWAYS",
      thinkingSteps: JSON.stringify([
        "Planning",
        "Researching",
        "Drafting",
        "Reviewing",
      ]),
    },
  });

  const gptBot = await prisma.bot.upsert({
    where: { id: IDS.gptBot },
    update: {},
    create: {
      id: IDS.gptBot,
      name: "GPT-4",
      serverId: server.id,
      llmProvider: "openai",
      llmModel: "gpt-4o",
      apiEndpoint: "https://api.openai.com/v1/chat/completions",
      apiKeyEncrypted: placeholderKey,
      systemPrompt:
        "You are GPT-4, a large language model by OpenAI. Be helpful, creative, and precise.",
      temperature: 0.8,
      maxTokens: 4096,
      isActive: true,
      triggerMode: "MENTION",
      thinkingSteps: JSON.stringify([
        "Analyzing",
        "Generating",
        "Refining",
      ]),
    },
  });

  const llamaBot = await prisma.bot.upsert({
    where: { id: IDS.llamaBot },
    update: {},
    create: {
      id: IDS.llamaBot,
      name: "Llama 3",
      serverId: server.id,
      llmProvider: "ollama",
      llmModel: "llama3",
      apiEndpoint: "http://localhost:11434/api/chat",
      apiKeyEncrypted: placeholderKey,
      systemPrompt:
        "You are Llama 3, an open-source language model by Meta. Be direct and helpful.",
      temperature: 0.6,
      maxTokens: 2048,
      isActive: true,
      triggerMode: "MENTION",
      thinkingSteps: JSON.stringify(["Processing", "Writing"]),
    },
  });
  console.log("  ✓ Bots: Claude (always), GPT-4 (mention), Llama 3 (mention)");

  // -----------------------------------------------------------------------
  // 6. Channels
  // -----------------------------------------------------------------------
  const generalChannel = await prisma.channel.upsert({
    where: { id: IDS.generalChannel },
    update: {},
    create: {
      id: IDS.generalChannel,
      serverId: server.id,
      name: "general",
      topic: "General discussion with AI agents",
      position: 0,
      defaultBotId: claudeBot.id,
      lastSequence: BigInt(10),
    },
  });

  const researchChannel = await prisma.channel.upsert({
    where: { id: IDS.researchChannel },
    update: {},
    create: {
      id: IDS.researchChannel,
      serverId: server.id,
      name: "research",
      topic: "AI research papers and experiments",
      position: 1,
      defaultBotId: claudeBot.id,
      lastSequence: BigInt(5),
    },
  });

  const devChannel = await prisma.channel.upsert({
    where: { id: IDS.devChannel },
    update: {},
    create: {
      id: IDS.devChannel,
      serverId: server.id,
      name: "dev",
      topic: "Development and coding help",
      position: 2,
      defaultBotId: gptBot.id,
      lastSequence: BigInt(3),
    },
  });
  console.log("  ✓ Channels: #general, #research, #dev");

  // -----------------------------------------------------------------------
  // 7. ChannelBots (multi-bot assignment)
  // -----------------------------------------------------------------------
  const channelBotData = [
    {
      id: IDS.cbClaudeGeneral,
      channelId: generalChannel.id,
      botId: claudeBot.id,
    },
    {
      id: IDS.cbGptGeneral,
      channelId: generalChannel.id,
      botId: gptBot.id,
    },
    {
      id: IDS.cbClaudeResearch,
      channelId: researchChannel.id,
      botId: claudeBot.id,
    },
    {
      id: IDS.cbLlamaResearch,
      channelId: researchChannel.id,
      botId: llamaBot.id,
    },
    { id: IDS.cbGptDev, channelId: devChannel.id, botId: gptBot.id },
  ];

  for (const cb of channelBotData) {
    await prisma.channelBot.upsert({
      where: { channelId_botId: { channelId: cb.channelId, botId: cb.botId } },
      update: {},
      create: cb,
    });
  }
  console.log(
    "  ✓ ChannelBots: #general(Claude+GPT), #research(Claude+Llama), #dev(GPT)"
  );

  // -----------------------------------------------------------------------
  // 8. Messages in #general
  // -----------------------------------------------------------------------
  const now = Date.now();
  const minute = 60_000;

  // Human conversation + bot responses with thinking timelines
  const messages = [
    {
      id: IDS.msg1,
      channelId: generalChannel.id,
      authorId: demoUser.id,
      authorType: "USER",
      content: "Hey everyone! Welcome to the AI Research Lab. 👋",
      type: "STANDARD",
      sequence: BigInt(1),
      createdAt: new Date(now - 30 * minute),
    },
    {
      id: IDS.msg2,
      channelId: generalChannel.id,
      authorId: alice.id,
      authorType: "USER",
      content: "Thanks for the invite! Excited to test multi-agent workflows here.",
      type: "STANDARD",
      sequence: BigInt(2),
      createdAt: new Date(now - 28 * minute),
    },
    {
      id: IDS.msg3,
      channelId: generalChannel.id,
      authorId: bob.id,
      authorType: "USER",
      content:
        "Can we compare how Claude and GPT-4 approach the same problem? @Claude @GPT-4 What are the top 3 approaches to reduce LLM hallucination?",
      type: "STANDARD",
      sequence: BigInt(3),
      createdAt: new Date(now - 25 * minute),
    },
    {
      id: IDS.msg4,
      channelId: generalChannel.id,
      authorId: claudeBot.id,
      authorType: "BOT",
      content:
        "Great question! Here are the top 3 approaches to reduce LLM hallucination:\n\n**1. Retrieval-Augmented Generation (RAG)**\nGround responses in retrieved documents rather than relying solely on parametric knowledge. This provides verifiable sources and reduces confabulation.\n\n**2. Chain-of-Thought Verification**\nForce the model to show reasoning steps, then verify each step against known facts. Self-consistency checks across multiple generations also help.\n\n**3. Constrained Decoding + Structured Output**\nUse schema-constrained output (JSON schema, grammar-guided decoding) to prevent free-form hallucination. Tools like Outlines and Instructor implement this.\n\nThe most effective approach combines all three: retrieve context, reason step-by-step over it, and constrain the output format.",
      type: "STREAMING",
      streamingStatus: "COMPLETE",
      sequence: BigInt(4),
      thinkingTimeline: JSON.stringify([
        { phase: "Planning", timestamp: now - 24 * minute },
        { phase: "Researching", timestamp: now - 24 * minute + 2000 },
        { phase: "Drafting", timestamp: now - 24 * minute + 5000 },
        { phase: "Reviewing", timestamp: now - 24 * minute + 12000 },
      ]),
      createdAt: new Date(now - 24 * minute),
    },
    {
      id: IDS.msg5,
      channelId: generalChannel.id,
      authorId: gptBot.id,
      authorType: "BOT",
      content:
        "Here are my top 3 approaches to reducing LLM hallucination:\n\n**1. Fine-tuning on Verified Data**\nTrain or fine-tune on curated, fact-checked datasets. RLHF with human evaluators who specifically flag hallucinations has shown significant improvement.\n\n**2. Retrieval-Augmented Generation**\nSimilar to Claude's suggestion — I'd emphasize using dense retrieval (ColBERT, DPR) over sparse methods for better precision.\n\n**3. Uncertainty Quantification**\nHave the model express confidence levels. When uncertainty is high, defer to retrieval or flag for human review. This is underexplored but highly promising.\n\nI'd also add: prompt engineering (explicit instructions to say \"I don't know\") is a simple but effective zero-cost intervention.",
      type: "STREAMING",
      streamingStatus: "COMPLETE",
      sequence: BigInt(5),
      thinkingTimeline: JSON.stringify([
        { phase: "Analyzing", timestamp: now - 23 * minute },
        { phase: "Generating", timestamp: now - 23 * minute + 3000 },
        { phase: "Refining", timestamp: now - 23 * minute + 10000 },
      ]),
      createdAt: new Date(now - 23 * minute),
    },
    {
      id: IDS.msg6,
      channelId: generalChannel.id,
      authorId: alice.id,
      authorType: "USER",
      content:
        "Interesting how both mentioned RAG but diverged on the other two. Claude went with constrained decoding, GPT-4 with uncertainty quantification. 🤔",
      type: "STANDARD",
      sequence: BigInt(6),
      createdAt: new Date(now - 20 * minute),
    },
    {
      id: IDS.msg7,
      channelId: generalChannel.id,
      authorId: demoUser.id,
      authorType: "USER",
      content:
        "This is exactly the kind of comparison I built this for. Both good answers, different perspectives. @Claude can you elaborate on constrained decoding?",
      type: "STANDARD",
      sequence: BigInt(7),
      createdAt: new Date(now - 18 * minute),
    },
    {
      id: IDS.msg8,
      channelId: generalChannel.id,
      authorId: claudeBot.id,
      authorType: "BOT",
      content:
        "Constrained decoding restricts the model's output space at inference time. Instead of freely generating any token, you define a grammar or schema that the output must conform to.\n\n**How it works:**\n- At each decoding step, mask logits for tokens that would violate the schema\n- The model can only produce syntactically valid output\n- Works with any model without retraining\n\n**Libraries:**\n- `outlines` (Python) — grammar-guided generation\n- `instructor` — Pydantic model validation for LLM outputs  \n- `guidance` (Microsoft) — template-based constrained generation\n\nThis doesn't prevent semantic hallucination (wrong facts in the right format), but it eliminates structural hallucination and makes the output reliably parseable.",
      type: "STREAMING",
      streamingStatus: "COMPLETE",
      sequence: BigInt(8),
      thinkingTimeline: JSON.stringify([
        { phase: "Planning", timestamp: now - 17 * minute },
        { phase: "Researching", timestamp: now - 17 * minute + 1500 },
        { phase: "Drafting", timestamp: now - 17 * minute + 4000 },
        { phase: "Reviewing", timestamp: now - 17 * minute + 9000 },
      ]),
      createdAt: new Date(now - 17 * minute),
    },
  ];

  // Messages in #research
  const researchMessages = [
    {
      id: IDS.msg9,
      channelId: researchChannel.id,
      authorId: alice.id,
      authorType: "USER",
      content:
        "Has anyone read the new DeepMind paper on scaling test-time compute? Curious what the agents think.",
      type: "STANDARD",
      sequence: BigInt(1),
      createdAt: new Date(now - 15 * minute),
    },
  ];

  // Messages in #dev
  const devMessages = [
    {
      id: IDS.msg10,
      channelId: devChannel.id,
      authorId: bob.id,
      authorType: "USER",
      content:
        "Working on the API integration. @GPT-4 what's the best way to handle streaming SSE responses in Go?",
      type: "STANDARD",
      sequence: BigInt(1),
      createdAt: new Date(now - 10 * minute),
    },
  ];

  const allMessages = [...messages, ...researchMessages, ...devMessages];

  for (const msg of allMessages) {
    await prisma.message.upsert({
      where: { id: msg.id },
      update: {},
      create: msg,
    });
  }
  console.log(`  ✓ Messages: ${allMessages.length} messages across 3 channels`);

  // -----------------------------------------------------------------------
  // 9. Reactions
  // -----------------------------------------------------------------------
  const reactions = [
    {
      id: IDS.react1,
      messageId: IDS.msg4,
      userId: demoUser.id,
      emoji: "🔥",
    },
    {
      id: IDS.react2,
      messageId: IDS.msg4,
      userId: alice.id,
      emoji: "👍",
    },
    {
      id: IDS.react3,
      messageId: IDS.msg5,
      userId: bob.id,
      emoji: "💡",
    },
    {
      id: IDS.react4,
      messageId: IDS.msg8,
      userId: alice.id,
      emoji: "🙏",
    },
  ];

  for (const r of reactions) {
    await prisma.reaction.upsert({
      where: {
        messageId_userId_emoji: {
          messageId: r.messageId,
          userId: r.userId,
          emoji: r.emoji,
        },
      },
      update: {},
      create: r,
    });
  }
  console.log("  ✓ Reactions: 4 reactions on bot messages");

  // -----------------------------------------------------------------------
  // 10. Mentions
  // -----------------------------------------------------------------------
  // MessageMention.userId references User.id — bots aren't Users,
  // so bot @mentions are text-only in content (e.g. "@Claude").
  console.log("  ✓ Mentions: bot @mentions are text-only (bots are not Users)");

  // -----------------------------------------------------------------------
  // 11. Channel Read States (create unread badges for demo)
  // -----------------------------------------------------------------------
  // Demo user has read #general up to msg 5, so msgs 6-8 are unread
  await prisma.channelReadState.upsert({
    where: {
      userId_channelId: {
        userId: demoUser.id,
        channelId: generalChannel.id,
      },
    },
    update: {},
    create: {
      id: IDS.rs1,
      userId: demoUser.id,
      channelId: generalChannel.id,
      lastReadSeq: BigInt(5),
      mentionCount: 0,
    },
  });

  // Demo user hasn't read #research at all — 1 unread
  await prisma.channelReadState.upsert({
    where: {
      userId_channelId: {
        userId: demoUser.id,
        channelId: researchChannel.id,
      },
    },
    update: {},
    create: {
      id: IDS.rs2,
      userId: demoUser.id,
      channelId: researchChannel.id,
      lastReadSeq: BigInt(0),
      mentionCount: 0,
    },
  });

  // Alice has unread mention in #general (msg7 mentions Claude after her last read)
  await prisma.channelReadState.upsert({
    where: {
      userId_channelId: {
        userId: alice.id,
        channelId: generalChannel.id,
      },
    },
    update: {},
    create: {
      id: IDS.rs3,
      userId: alice.id,
      channelId: generalChannel.id,
      lastReadSeq: BigInt(6),
      mentionCount: 0,
    },
  });

  console.log("  ✓ Read states: unread badges for demo user");

  // -----------------------------------------------------------------------
  // 12. Invite link
  // -----------------------------------------------------------------------
  await prisma.invite.upsert({
    where: { code: "DEMO2026" },
    update: {},
    create: {
      id: IDS.invite1,
      serverId: server.id,
      creatorId: demoUser.id,
      code: "DEMO2026",
      maxUses: 100,
      uses: 3,
      expiresAt: new Date(now + 30 * 24 * 60 * minute), // 30 days
    },
  });
  console.log("  ✓ Invite: code DEMO2026");

  // -----------------------------------------------------------------------
  // 13. Write seed IDs for test scripts (non-fatal — Docker container
  //     may not have write access to /app/prisma/)
  // -----------------------------------------------------------------------
  try {
    const fs = await import("node:fs");
    const seedIds = {
      serverId: server.id,
      generalChannelId: generalChannel.id,
      researchChannelId: researchChannel.id,
      devChannelId: devChannel.id,
    };
    fs.writeFileSync(
      path.join(__dirname, ".seed-ids.json"),
      JSON.stringify(seedIds, null, 2)
    );
    console.log("  ✓ Wrote prisma/.seed-ids.json");
  } catch {
    console.log("  ⚠ Could not write prisma/.seed-ids.json (read-only filesystem, skipping)");
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log("\n🎉 Seed complete!\n");
  console.log("  Login:    demo@tavok.ai / DemoPass123!");
  console.log("  Server:   AI Research Lab");
  console.log("  Channels: #general (Claude+GPT), #research (Claude+Llama), #dev (GPT)");
  console.log("  Invite:   DEMO2026\n");
  console.log(
    "  Note: Bot API keys are placeholders. Replace them in the UI to enable streaming.\n"
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
