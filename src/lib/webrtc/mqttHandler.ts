// mqttHandler.ts
import mqtt, {MqttClient} from "mqtt";
import type {SignalingMessage} from "./signalingTypes";

export type PublisherName = string;   // "teleco001" など
export type SubscriberName = string;  // "teleco001" など

export interface MqttHandlerConfig {
    room?: string;                 // 例: "testroom"
    experimentPrefix?: string;     // 例: "testing"
    host?: string;                 // 例: "wss://example.com/mosmos-test2/ws/"
    username?: string;
    password?: string;
    onConnected?: () => void;
}

export type SignalingCallback = (msg: SignalingMessage) => void;

export class MqttHandler {
    private client: MqttClient;
    private pathBase: string;
    private publisherTopics: Map<PublisherName, string> = new Map();
    private subscriberHandlers: Map<string, SignalingCallback> = new Map();

    constructor(config: MqttHandlerConfig = {}) {
        const room = config.room ?? "testroom";
        const prefix = config.experimentPrefix ?? "testing";

        // /topic/testing/testroom
        this.pathBase = `/topic/${prefix}/${room}`;

        const host =
            config.host ?? `wss://${location.host}/mosmos-test2/ws/`;

        const username = config.username ?? process.env.NEXT_PUBLIC_MQTT_USERNAME ?? "commu";

        const password = config.password ?? process.env.NEXT_PUBLIC_MQTT_PASSWORD ?? "zD5%rZ$m/i+W";

        this.client = mqtt.connect(host, {
            keepalive: 60,
            clientId: "gui-" + Math.random().toString(36).slice(2),
            username,
            password,
            protocolId: "MQTT",
            protocolVersion: 4,
            clean: true,
            reconnectPeriod: 1000,
            connectTimeout: 30 * 1000,
            will: {
                topic: "WillMsg",
                payload: "Connection Closed abnormally..!",
                qos: 0,
                retain: false,
            },
        });

        this.client.on("connect", () => {
            console.log("[MQTT] connected");
            config.onConnected?.();
        });

        this.client.on("error", (err) => {
            console.error("[MQTT] connection error", err);
        });

        this.client.on("reconnect", () => {
            console.log("[MQTT] reconnecting...");
        });

        this.client.on("message", (topic, payload) => {
            try {
                const json = JSON.parse(payload.toString()) as SignalingMessage;
                const handler = this.subscriberHandlers.get(topic);
                handler?.(json);
            } catch (e) {
                console.error("[MQTT] invalid message", e);
            }
        });
    }

    // ex: "teleco001", "/teleco-001/command"
    addPublisher(name: PublisherName, subPath: string) {
        const topic = this.pathBase + subPath; // /topic/.../teleco-001/command
        this.publisherTopics.set(name, topic);
    }

    // ex: "teleco001", "/teleco-001/INFO"
    addSubscriber(name: SubscriberName, subPath: string, cb: SignalingCallback) {
        const topic = this.pathBase + subPath;
        this.subscriberHandlers.set(topic, cb);
        this.client.subscribe(topic);
    }

    // ある teleco 宛に signaling メッセージを publish
    sendToPublisher(name: PublisherName, msg: SignalingMessage) {
        const topic = this.publisherTopics.get(name);
        if (!topic) {
            console.warn("[MQTT] publisher not found:", name);
            return;
        }
        this.client.publish(topic, JSON.stringify(msg));
    }
}
