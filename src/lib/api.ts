export type AppConfiguration = {
  version: string;
  features: string[];
};

function isAppConfiguration(value: unknown): value is AppConfiguration {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;

  if (typeof record.version !== "string") return false;
  if (!Array.isArray(record.features)) return false;
  if (!record.features.every((feature) => typeof feature === "string")) {
    return false;
  }

  return true;
}

export async function fetchConfiguration(): Promise<AppConfiguration> {
  const response = await fetch("/api/get_configuration", {
    method: "GET",
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error("Failed to fetch configuration");
  }
  const payload: unknown = await response.json();
  if (!isAppConfiguration(payload)) {
    throw new Error("Invalid configuration response");
  }
  return payload;
}
