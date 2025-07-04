import { Config, Context, Effect, Layer, pipe } from "effect";
import type { AMQPTlsOptions } from "@cloudamqp/amqp-client";

export interface AMQPConnectionOptions {
  url: string;
  heartbeat?: number;
  vhost?: string;
  username?: string;
  password?: string;
  tlsOptions?: AMQPTlsOptions;
}

export class AMQPConfig extends Context.Tag("AMQPConfig")<
  AMQPConfig,
  AMQPConnectionOptions
>() {}

export const layer = (options: AMQPConnectionOptions) =>
  Layer.effect(AMQPConfig, Effect.succeed(options));

export const layerConfig = (config: Config.Config.Wrap<AMQPConnectionOptions>) =>
  pipe(config, Config.unwrap, Layer.effect(AMQPConfig));