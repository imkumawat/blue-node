import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import { v7 as uuidv7 } from "uuid";
import { getEnvConfig } from "../../config/env.js";
import logger from "../../utils/logger.js";

let _client: MqttClient | undefined;

/**
 * Connect to the MQTT broker. Unlike Redis/Postgres/Mongo (core services that
 * hard-exit on boot failure and gate serviceAvailability), MQTT is a FEATURE
 * transport (delivery tracking): if the broker is down the rest of the app must
 * keep serving, so a failed connect logs and relies on mqtt.js auto-reconnect —
 * it does NOT process.exit and is NOT tracked in serviceState.
 */
export async function connectMqtt(): Promise<void> {
  const {
    url,
    username,
    password,
    connectTimeoutMs,
    reconnectPeriodMs,
    keepaliveSec,
  } = getEnvConfig().mqtt;

  _client = mqtt.connect(url, {
    clientId: `backend-${uuidv7()}`, // unique per process — broker kicks duplicate clientIds
    username,
    password,
    clean: true, // backend is a stateless re-subscriber; no broker-side session needed
    protocolVersion: 5, // MQTT 5 (response-topic, richer acks)
    connectTimeout: connectTimeoutMs,
    reconnectPeriod: reconnectPeriodMs, // auto-reconnect (0 would disable)
    keepalive: keepaliveSec,
  });

  _client.on("connect", () => logger.info("MQTT connected"));
  _client.on("reconnect", () => logger.warn("MQTT reconnecting"));
  _client.on("error", (err) =>
    logger.error({ err: err.message }, "MQTT error"),
  );

  // Wait for the FIRST connect (bounded) so boot logs are accurate, but degrade
  // gracefully on timeout — auto-reconnect keeps trying in the background.
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      _client!.removeListener("connect", onConnect);
      logger.error("MQTT initial connect timed out — continuing, will retry");
      resolve();
    }, connectTimeoutMs);
    function onConnect(): void {
      clearTimeout(timer); // connected in time — cancel the timeout
      resolve();
    }
    _client!.once("connect", onConnect);
  });
}

export async function disconnectMqtt(): Promise<void> {
  try {
    await _client?.endAsync();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "MQTT end() failed during shutdown",
    );
  }
  _client = undefined;
  logger.info("MQTT disconnected");
}

/**
 * Returns the MQTT client. Throws if `connectMqtt()` hasn't run.
 * Use this instead of a module-level client — explicit runtime errors + mockable.
 */
export function getMqtt(): MqttClient {
  if (!_client) {
    throw new Error("MQTT not connected. Call connectMqtt() first.");
  }
  return _client;
}
