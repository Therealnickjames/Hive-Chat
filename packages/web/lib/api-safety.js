export function canMutateServerScopedResource(routeServerId, targetServerId) {
  return (
    typeof routeServerId === "string" &&
    typeof targetServerId === "string" &&
    routeServerId === targetServerId
  );
}

export function isJsonObjectBody(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function getRedisHealthStatus(redisUrl, probeRedisHealth) {
  if (!redisUrl) {
    return "unhealthy";
  }

  try {
    const redisHealthy = await probeRedisHealth(redisUrl);
    return redisHealthy ? "ok" : "unhealthy";
  } catch {
    return "unhealthy";
  }
}

export function serializeSequence(sequence) {
  return sequence.toString();
}

export function parseNonNegativeSequence(sequence) {
  if (
    typeof sequence !== "string" &&
    typeof sequence !== "number" &&
    typeof sequence !== "bigint"
  ) {
    return null;
  }

  if (typeof sequence === "string" && sequence.trim() === "") {
    return null;
  }

  try {
    const parsed = BigInt(
      typeof sequence === "string" ? sequence.trim() : sequence
    );
    return parsed >= BigInt(0) ? parsed : null;
  } catch {
    return null;
  }
}

export function buildMonotonicLastSequenceUpdate(channelId, sequenceBigInt) {
  return {
    where: {
      id: channelId,
      lastSequence: { lt: sequenceBigInt },
    },
    data: { lastSequence: sequenceBigInt },
  };
}
