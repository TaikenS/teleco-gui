import mqtt, { type IClientOptions, type MqttClient } from "mqtt";

export interface BrowserMqttConfig {
  url: string; // e.g. wss://broker.example.com/mosmos-test2/ws/
  prefix: string; // e.g. testing
  room: string; // e.g. testroom
  clientId?: string;
  username?: string;
  password?: string;
}

/**
 * Browser-friendly MQTT client wrapper.
 * Follows mqttClient.ts convention:
 *   basePath = /topic/${prefix}/${room}
 *   publish = ${basePath}/${topicName}
 */
export class BrowserMqttClientWrapper {
  private client: MqttClient;
  private basePath: string;

  constructor(cfg: BrowserMqttConfig) {
    this.basePath = `/topic/${cfg.prefix}/${cfg.room}`.replace(/\/+$/g, "");

    const options: IClientOptions = {
      clientId:
        cfg.clientId ??
        `teleco-gui-${Math.random().toString(16).slice(2)}-${Date.now()}`,
      username: cfg.username,
      password: cfg.password,
      protocolVersion: 4,
      clean: true,
      reconnectPeriod: 1000,
      connectTimeout: 30_000,
      will: {
        topic: "WillMsg",
        payload: "Connection Closed abnormally..!",
        qos: 0,
        retain: false,
      },
    };

    this.client = mqtt.connect(cfg.url, options);
  }

  onConnect(cb: () => void) {
    this.client.on("connect", cb);
  }

  onError(cb: (err: Error) => void) {
    // mqtt typings: error can be Error | any; normalize
    this.client.on("error", (e: unknown) =>
      cb(e instanceof Error ? e : new Error(String(e))),
    );
  }

  publish(topicName: string, message: unknown) {
    const fullTopic = `${this.basePath}/${topicName}`.replace(/\/+/g, "/");
    this.client.publish(fullTopic, JSON.stringify(message));
  }

  end(force = true) {
    this.client.end(force);
  }
}

/** Read config from NEXT_PUBLIC_* env vars (client side). */
export function getBrowserMqttConfigFromEnv(): BrowserMqttConfig | null {
  const url = process.env.NEXT_PUBLIC_MQTT_URL;
  const prefix = process.env.NEXT_PUBLIC_MQTT_PREFIX;
  const room = process.env.NEXT_PUBLIC_MQTT_ROOM;

  if (!url || !prefix || !room) {
    return null;
  }

  return {
    url,
    prefix,
    room,
    username: process.env.NEXT_PUBLIC_MQTT_USERNAME,
    password: process.env.NEXT_PUBLIC_MQTT_PASSWORD,
    clientId: process.env.NEXT_PUBLIC_MQTT_CLIENT_ID,
  };
}
