-- Remove agent self-registration and approval flow (DEC-0060)
-- These fields are no longer needed since agents are created by
-- server owners via CLI or UI, not by self-registration.

-- Drop ApprovalStatus enum values from AgentRegistration
ALTER TABLE "AgentRegistration" DROP COLUMN IF EXISTS "approvalStatus";
ALTER TABLE "AgentRegistration" DROP COLUMN IF EXISTS "reviewedBy";
ALTER TABLE "AgentRegistration" DROP COLUMN IF EXISTS "reviewedAt";

-- Drop registration control fields from Server
ALTER TABLE "Server" DROP COLUMN IF EXISTS "allowAgentRegistration";
ALTER TABLE "Server" DROP COLUMN IF EXISTS "registrationApprovalRequired";

-- Drop the ApprovalStatus enum type
DROP TYPE IF EXISTS "ApprovalStatus";
