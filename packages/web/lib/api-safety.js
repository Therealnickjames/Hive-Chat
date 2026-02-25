export function canMutateServerScopedResource(routeServerId, targetServerId) {
  return (
    typeof routeServerId === "string" &&
    typeof targetServerId === "string" &&
    routeServerId === targetServerId
  );
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
